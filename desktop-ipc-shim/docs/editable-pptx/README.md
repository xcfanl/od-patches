# Editable PPTX — shim 落地方案

本目录保存 **od-desktop-ipc-shim** 实现「可编辑 PPTX」导出的方案笔记，对照上游 OpenDesign Electron desktop（`apps/desktop/src/main/deck-capture.ts`）。

## 为什么存在

截图导出只给出位图幻灯片，文字不可改、字体/版式也难二次编辑。产品侧需要 **native shapes + 可选中文本** 的 PPTX，上游这条路径在 Electron 里已经打通（注入 `dom-to-pptx`），但 **shim 环境没有 Electron**，必须把同一套语义搬到 Puppeteer + 系统 Chrome，且仍走 daemon 的 `pptxFile` 手递契约。

本目录文档存在的理由：

- 把上游调用链、可移植 API、分期计划从对话里固化下来，避免只活在某台机器的记忆里
- 明确 **out-of-tree** 边界：shim 复刻行为，不改 `open-design` 源码
- 记录与上游的已知差距（分层背景、stage 尺寸、CJK 嵌入策略等），方便回归

实现代码在 `../src/editable-*.ts|mjs`；本目录是设计与对照文档，不是运行时依赖。

| 文档 | 内容 |
|------|------|
| [upstream-map.md](./upstream-map.md) | 上游调用链、关键函数、IPC/daemon 契约 |
| [implementation-plan.md](./implementation-plan.md) | 分阶段实现步骤、文件落点、风险与验收 |
| [api-surface.md](./api-surface.md) | 需要从上游移植/适配的页面侧 API 清单 |

包级用法见：[../../README.md](../../README.md)（仓库）· [../README.md](../README.md)（shim）。

## 一句话结论

上游可编辑导出 = **在已布局的 Chromium 页面里注入 vendored `dom-to-pptx` UMD**，对全部 slide 做 DOM 规范化 →（可选）分层背景截图 → `exportToPptx` 产出 `.pptx` 字节，经 `pptxFile` 交给 daemon。

shim 复用同一引擎与 prepare/export 两阶段语义，把 Electron `executeJavaScript` / debugger CDP 换成 Puppeteer `page.evaluate` / CDP，并遵守本仓库已固定的 **1280×720** stage。平台字体（PingFang / 微软雅黑等）映射为可嵌入的 Noto 并写入 `ppt/fonts`。

## 不做的事

- 不改 open-design 上游源码（shim 仍是 out-of-tree）。
- 不 `npm install dom-to-pptx`（会拖入 puppeteer 二次 Chromium）；继续 vendor gzip bundle。
- 不在第一期追求与 Electron 逐像素一致的分层背景；可先跳过 layered backgrounds，再补齐。
