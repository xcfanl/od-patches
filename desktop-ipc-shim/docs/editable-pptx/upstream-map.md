# 上游可编辑 PPTX 地图

对照树：`/home/open-design`（OpenDesign）。

## 端到端调用链

```
Web UI (pptxExportMode === 'editable')
  → POST /api/projects/:id/export/pptx  { editable: true, deck: true, ... }
  → daemon handleScreenshotExport
       buildDeckRenderInput({ editable: true, outputDir, html, baseHref, ... })
  → IPC desktop.sock  type=render-slides
  → Electron renderDeckSlides(input)
       if input.editable → renderEditablePptx(...)
  ← { ok, pptxFile, width, height, mode: 'deck' }
  → daemon 校验 pptxFile ⊆ outputDir，直接流式返回 .pptx
```

截图路径返回 `slideFiles[]`，由 daemon 的 `buildScreenshotPptx` 拼装；**可编辑路径不经该拼装**，renderer 自己写出完整 pptx。

## 关键源码位置

| 职责 | 路径 |
|------|------|
| IPC 入口 / 路由到 renderDeckSlides | `apps/desktop/src/main/runtime.ts` |
| 主流程（含 editable 分支） | `apps/desktop/src/main/deck-capture.ts` → `renderDeckSlides` / `renderEditablePptx` |
| DOM→PPTX 引擎（vendored UMD） | `apps/desktop/vendor/dom-to-pptx/dom-to-pptx.bundle.js(.gz)` |
| 引擎说明 | `apps/desktop/vendor/dom-to-pptx/README.md`（dom-to-pptx **2.0.1**，MIT） |
| 打包注入 extraResources | `tools/pack/src/dom-to-pptx-resource.ts` |
| postinstall 解压 gzip | `scripts/postinstall.mjs` |
| daemon 可编辑手递 | `apps/daemon/src/import-export-routes.ts`（`renderOptions.editable` 分支） |
| 输入契约 | `@open-design/sidecar-proto` → `DesktopRenderSlidesInput.editable` |
| CJK / 保真测试 | `apps/desktop/tests/main/pptx-*.test.ts` |

## `renderEditablePptx` 步骤（上游）

1. **`showAllSlides`**：所有真实 slide 同时 `opacity/visibility` 可见，并 `position:absolute; left/top:0`（dom-to-pptx 需要每个元素有 live layout；正常 deck 只显示当前页）。
2. **`collectImportedStylesheetUrls`**：从 inline `<style>` 里扫 `@import`。
3. **`fetchGoogleFontStylesheets`（Node 侧）**：只拉 `fonts.googleapis.com`，用通用 UA，避免 Chromium WOFF2 子集在 PPTX 嵌入时翻车。
4. **`loadDomToPptxBundle`**：读 `.gz` 或 `.js`，注入 render window（定义 `window.domToPptx`）。
5. **`runDomToPptx(..., "prepare")`**：几何相关规范化（背景显式化、大单行文本稳定、标题行稳定、CJK 字体提升、SVG `className` 字符串化）。**不调用 export**。
6. **`captureEditablePptxLayeredBackgrounds`**：对多层 CSS gradient 等目标做隔离 + CDP `Page.captureScreenshot`，得到 raster 层，供 export 贴回（避免 dom-to-pptx 丢失复杂背景）。
7. **`runDomToPptx(..., layeredBackgrounds, "export-prepared")`**：不再动 DOM 几何，调用：

   ```js
   window.domToPptx.exportToPptx(slides, {
     fileName: "deck.pptx",
     skipDownload: true,
     autoEmbedFonts: true,
     fonts: importedFonts,   // optional
     svgAsVector: true,
   })
   ```

   Blob → base64 → Node 写 `outputDir/deck.pptx`，返回 `{ ok, pptxFile, width, height, mode: "deck" }`。

## 共享前置（与截图路径相同）

在进入 `renderEditablePptx` 之前，上游已完成：

- `injectBaseHref` + 加载 HTML
- `waitForPrintableContent`
- `countRealSlides` / `shouldCaptureAsDeck`
- `prepareDeckStage`（藏 chrome、冻结动画、`noscale`）
- 测 stage / pin（上游默认 1920×1080；shim 已固定 **1280×720**）

## IPC 结果契约（daemon 期望）

可编辑成功时必须：

```ts
{
  ok: true,
  mode: "deck",
  pptxFile: "<absolute path under outputDir>/deck.pptx",
  width: number,
  height: number,
}
```

失败：`ok: false` + `error` + `errorCode: "RENDER_FAILED"`（或既有码）。

daemon 会 `realpath` 校验 `pptxFile` 必须落在 scratch `outputDir` 内，再 `Content-Type: application/vnd...presentationml.presentation` 回传。

## 引擎依赖说明

- **不要**把 `dom-to-pptx` npm 包直接装进 shim（其 Node entry 依赖 puppeteer，会再下一份 Chromium）。
- 与上游一致：只 vendor **browser UMD**（`.bundle.js.gz`），运行时 gunzip 后 `page.evaluate` / `page.addScriptTag` 注入。
- 全局 API：`window.domToPptx.exportToPptx(elementOrSelector, options)`。
