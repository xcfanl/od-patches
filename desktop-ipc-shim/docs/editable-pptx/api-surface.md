# 需移植 / 适配的 API 表面

来源：`/home/open-design/apps/desktop/src/main/deck-capture.ts`。  
「注入」= 必须能在 Chromium page 上下文执行；「Node」= 只在 shim 进程跑。

## Phase A（MVP）

| 符号 | 侧 | 作用 | shim 落点建议 |
|------|----|------|----------------|
| `loadDomToPptxBundle` / `readDomToPptxBundleFile` | Node | 读 gzip/js vendor | `editable-pptx.ts` |
| `fetchGoogleFontStylesheets` | Node | 预取 Google Fonts CSS | `editable-pptx.ts` |
| `showAllSlides` | 注入 | 全 slide 同时布局 | `page-scripts.mjs` → `pageFns` |
| `collectImportedStylesheetUrls` | 注入 | 收集 `@import` URL | `page-scripts.mjs` |
| `runDomToPptx`（最小路径） | 注入 | prepare 可选；`exportToPptx` → `{ b64 }` | 独立 `editable-page.mjs` |
| `renderEditablePptx` 编排 | Node | evaluate 顺序 + 写 `deck.pptx` | `editable-pptx.ts` |

`exportToPptx` 选项（上游）：

```ts
{
  fileName: "deck.pptx",
  skipDownload: true,
  autoEmbedFonts: true,
  fonts?: Array<{ name: string; urls: string[] }>,
  svgAsVector: true,
}
```

## Phase B

| 符号 | 侧 | 作用 |
|------|----|------|
| `cjkPromotedFontFamily` | 注入（纯函数） | CJK 文本提升字体栈 |
| `promoteCjkTypefaces` | 注入（在 `runDomToPptx` 内） | 遍历 slide 应用提升 |
| `ensureExplicitSlideBackgrounds` | 注入 | 背景写入可被转换器读取 |
| `stabilizeLargeSingleLineText` | 注入 | 避免单行被错误拆分 |
| `stabilizeAuthoredHeadingLines` | 注入 | 标题行保真 |
| `exposeImportedFontFaces` | 注入 | `@import` → 可嵌入 font 列表 |
| `importedFontFaceCss` 等辅助 | 注入 | 字体子集选择 |

## Phase C

| 符号 | 侧 | 作用 |
|------|----|------|
| `collectLayeredPptxBackgroundTargets` | 注入 | 找出需光栅化的多层背景 |
| `isolateLayeredPptxBackground` / `restore…` | 注入 | 捕获前隔离 |
| `captureEditablePptxLayeredBackgrounds` | Node+CDP | 逐目标截透明 PNG |
| `preserveLayeredGradientBackgrounds` | 注入 | export 前贴回 raster |
| prepare / export-prepared 两阶段 | 编排 | 捕获夹在中间，禁止二次几何抖动 |

## 已与截图路径共享（无需重做）

- `injectBaseHref`, `countRealSlides`, `shouldCaptureAsDeck`
- `prepareDeckStage`, `pinDeckStage`, `lockExportGeometry`
- `pinCarouselSlidesForExport`（carousel deck 进入 editable 前应先 pin）
- `HIDE_CHROME_SELECTOR`, `SLIDE_SELECTOR`, `DECK_STAGE_SELECTOR`
- 固定 `SLIDE_W=1280`, `SLIDE_H=720`

## 刻意不移植

| 上游 | 原因 |
|------|------|
| `BrowserWindow` / `showInactive` / opacity 技巧 | Puppeteer headless 无窗口闪烁问题 |
| `capturePage` / Electron `nativeImage` | 可编辑路径不走位图拼 PPTX |
| `measureSlide` 覆盖 stage | shim 策略固定 1280×720 |
| 接收前端 `width`/`height` | 已从 shim 输入面移除 |
