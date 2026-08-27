# shim 实现计划

## 目标

在 `od-desktop-ipc-shim` 中支持 `render-slides` + `editable: true`，返回与 Electron 相同的 `pptxFile` 手递，使 Web「Export PPTX → editable」不再 501/502。

## 现状缺口

| 能力 | 截图模式 (shim) | 可编辑 (shim) | 可编辑 (Electron) |
|------|-----------------|---------------|-------------------|
| IPC `editable` | 立即失败 | ❌ | ✅ |
| dom-to-pptx 注入 | — | ❌ | ✅ |
| showAllSlides + prepare | — | ❌ | ✅ |
| Google Fonts 预取 + CJK promote | — | ❌ | ✅ |
| Layered background CDP 捕获 | — | ❌ | ✅ |
| 写出 `deck.pptx` | — | ❌ | ✅ |
| Stage | 固定 1280×720 | 同左 | 可测 / 可传宽高 |

## 推荐分期

### Phase A — MVP（打通可编辑下载）

**验收**：对含 `.slide` 的常见 deck，前端选 editable 能下载可在 PowerPoint/WPS 打开的 pptx（文字可选中，非整页位图）。

1. Vendor 拷贝上游 `dom-to-pptx.bundle.js.gz` + `LICENSE` + 版本说明到  
   `desktop-ipc-shim/vendor/dom-to-pptx/`（不提交解压后的大 `.js`；启动或首次导出时 gunzip 到内存/cache）。
2. 新增 `src/editable-pptx.ts`（或 `src/dom-to-pptx-export.ts`）：
   - `loadDomToPptxBundle()`
   - `fetchGoogleFontStylesheets()`（可从上游逻辑移植，纯 Node）
   - `renderEditablePptx(page, stage, outputDir)`
3. 在 `chrome-renderer.ts` 去掉「editable 直接失败」；deck 准备（prepare/pin）完成后分支：
   - `editable` → `renderEditablePptx`
   - 否则保持现有截图循环
4. 页面侧最小集（见 [api-surface.md](./api-surface.md) Phase A）：
   - `showAllSlides`
   - `collectImportedStylesheetUrls`
   - `runDomToPptx` 的精简版：至少包含 prepare 里的 SVG className 修复 + `exportToPptx` 调用 + base64 回传  
   - 第一期可暂缓完整 CJK / stabilize* / layered backgrounds（记为已知保真差距）
5. Smoke：`scripts/smoke-editable.ts`  
   - 2～3 张带文本的 slide → `editable: true` → 断言 `pptxFile` 存在且 ZIP 魔数 / `[Content_Types].xml` 可读。

### Phase B — 保真对齐（CJK + 字体嵌入）

1. 移植 `cjkPromotedFontFamily` + `promoteCjkTypefaces`（上游已有单测可对照）。
2. 移植 `exposeImportedFontFaces` / prepare 阶段的 `stabilize*` 与 `ensureExplicitSlideBackgrounds`。
3. 用上游 `pptx-cjk-typeface` / `pptx-editable-fidelity` 同类 HTML fixture 做回归。

### Phase C — 分层背景

1. 移植 `collectLayeredPptxBackgroundTargets` / isolate / restore。
2. Puppeteer CDP：`Page.captureScreenshot` + 透明背景 override（对应 Electron debugger 路径）。
3. prepare → capture layers → `export-prepared` 两阶段时序与上游一致。
4. 对照 `pptx-layered-background.test.ts` 场景。

### Phase D — 布局变体

1. **横向 carousel**（本仓库截图路径已 pin）：editable 前必须 `pinCarouselSlidesForExport` + `showAllSlides`，避免 100vw 条带导致测量错乱。
2. `<deck-stage>` shadow：确认 noscale + canvas 尺寸与 1280×720 stage 一致后再 export。
3. 超长 deck 内存：`exportToPptx` 在页内跑，注意超时（daemon IPC 已 600s）。

## 建议文件落点

```
desktop-ipc-shim/
  vendor/dom-to-pptx/
    README.md                 # 版本钉扎 + 更新步骤（抄上游 README）
    LICENSE
    dom-to-pptx.bundle.js.gz  # ~1MB，可提交
  src/
    chrome-renderer.ts        # editable 分支
    editable-pptx.ts          # Node：load bundle / fonts / orchestrate
    page-scripts.mjs          # 增加 showAllSlides 等可序列化 pageFns
    # 可选：把 runDomToPptx 大函数放独立 .mjs，避免 tsx __name 污染
  scripts/
    smoke-editable.ts
  docs/editable-pptx/         # 本方案（已存在）
```

## Puppeteer 适配要点

| Electron | Shim |
|----------|------|
| `webContents.executeJavaScript(fn.toString())` | 已有 `evalFn` + `new Function` 模式（防 tsx `__name`） |
| `webContents.executeJavaScript(bundleSource)` | `page.evaluate(bundle)` 或 `page.addScriptTag({ content })` |
| `debugger.sendCommand('Page.captureScreenshot')` | `page.createCDPSession()` |
| `window.setContentSize(w,h)` | `page.setViewport({ width, height, deviceScaleFactor: 1 })` |
| 默认 stage 1920×1080 | **固定 1280×720**（与当前截图一致；返回的 width/height 亦然） |

`runDomToPptx` 体积极大（~1k+ 行）：优先 **原样移植为 `.mjs` 字符串/函数**，不要用 tsx 编译进 page；与 `page-scripts.mjs` 同策略。

## 明确不做 / 延后

- 不实现 editable 的 page-mode（上游也是 deck-only）。
- 不改 daemon / web 契约。
- 不引入第二套 PPTX 组装（PptxGenJS 已在 bundle 内）。
- 不把解压后的 3.8MB `.bundle.js` 提交进 git。

## 验收清单

- [ ] `editable: false` 截图路径无回归（含 carousel 33 页 deck）。
- [ ] `editable: true` + `outputDir` → `pptxFile` 绝对路径在目录内。
- [ ] 前端 Export PPTX editable 不再 502（renderer 返回 ok）。
- [ ] 打开 pptx：至少标题/正文为可编辑文本框。
- [ ] （B）含「Noto Sans SC」的中文 deck 字体名合理。
- [ ] （C）多层 gradient hero 不完全丢失。

## 预估工作量（量级）

| Phase | 量级 |
|-------|------|
| A MVP | 1～2 天（移植 + vendor + smoke） |
| B CJK/字体 | 1 天 |
| C 分层背景 | 1～2 天（CDP 细节最多） |
| D 变体 | 0.5～1 天 |
