# Editable PPTX — shim 落地方案

本目录保存 **od-desktop-ipc-shim** 实现「可编辑 PPTX」导出的方案，对照上游 OpenDesign Electron desktop（`apps/desktop/src/main/deck-capture.ts`）的现有实现。

> 当前 shim 对 `input.editable === true` 直接返回 `RENDER_FAILED`。截图模式已可用；本方案只覆盖 **native shapes/text** 路径。

| 文档 | 内容 |
|------|------|
| [upstream-map.md](./upstream-map.md) | 上游调用链、关键函数、IPC/daemon 契约 |
| [implementation-plan.md](./implementation-plan.md) | 本仓库分阶段实现步骤、文件落点、风险与验收 |
| [api-surface.md](./api-surface.md) | 需要从上游移植/适配的页面侧 API 清单 |

## 一句话结论

上游可编辑导出 = **在已布局的 Chromium 页面里注入 vendored `dom-to-pptx` UMD**，对全部 slide 做 DOM 规范化 →（可选）分层背景截图 → `exportToPptx` 产出 `.pptx` 字节，经 `pptxFile` 交给 daemon。

shim 应复用同一引擎与同一 prepare/export 两阶段语义，把 Electron `executeJavaScript` / debugger CDP 换成 Puppeteer `page.evaluate` / CDP，并遵守本仓库已固定的 **1280×720** stage。

## 不做的事

- 不改 open-design 上游源码（shim 仍是 out-of-tree）。
- 不 `npm install dom-to-pptx`（会拖入 puppeteer 二次 Chromium）；继续 vendor gzip bundle。
- 不在第一期追求与 Electron 逐像素一致的分层背景；可先跳过 layered backgrounds，再补齐。
