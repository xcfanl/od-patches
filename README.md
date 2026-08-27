# od-patches

面向 [OpenDesign](https://github.com/nexu-io/open-design) 的 **out-of-tree 补丁 / 旁路组件** 集合。

## 为什么存在

OpenDesign 上游把部分能力（尤其是桌面侧 IPC、PPTX 导出）绑在 Electron Desktop 或需要改仓库内源码才能接上。很多部署场景只要 **Web + daemon**，不想装 Electron，也不想 fork / 长期 rebase 上游。

本仓库用来放那些「**必须旁路才能用、又不该污染 upstream**」的东西：

- 不修改 `open-design` 树内文件
- 以独立包对接既有 IPC / 协议
- 可在任意机器用环境变量配置路径
- 日后继续加模块（导出、运维、实验性工具等），而不是塞进上游 PR

当前仓库名 **`od-patches`** 即按「补丁合集」设计，暂不改名。

## 包导航

| 包 | 说明 | 文档 |
|----|------|------|
| [`desktop-ipc-shim`](./desktop-ipc-shim/) | 用系统 Chrome/Chromium 占用 `desktop.sock`，实现 `render-slides`（截图 PPTX + 可编辑 PPTX），无需 Electron Desktop | [README](./desktop-ipc-shim/README.md) · [为什么需要 shim](./desktop-ipc-shim/README.md#为什么存在) |

可编辑导出方案笔记：[desktop-ipc-shim/docs/editable-pptx/](./desktop-ipc-shim/docs/editable-pptx/)。

## 仓库结构

```text
od-patches/
├── README.md                 ← 本文件
├── desktop-ipc-shim/         ← Chrome headless desktop.sock shim
│   ├── README.md
│   ├── src/
│   ├── systemd/
│   └── vendor/dom-to-pptx/
└── …                         ← 后续包放在同级目录
```

## 与 OpenDesign 的关系

```text
<any>/open-design      ← 上游（需自行 clone 并 build sidecar）
<any>/od-patches       ← 本仓库（旁路组件）
```

各子包通过环境变量 / CLI 参数指向 OpenDesign 根目录（如 `OD_OPEN_DESIGN_ROOT`），**不依赖**本机固定路径。具体用法见对应包的 README。

## 快速开始（desktop-ipc-shim）

```bash
git clone <this-repo> od-patches
cd od-patches/desktop-ipc-shim
# 完整步骤、systemd、环境变量见包内文档：
#   desktop-ipc-shim/README.md
```

## 贡献约定

- 新能力优先做成 **新的子目录包**，在本 README 的「包导航」表里登记一行，并在包 README 写清 **为什么存在**。
- 不要把上游 OpenDesign 源码 vendoring 进本仓库（`dom-to-pptx` 浏览器 UMD 等明确声明的 vendor 除外）。
- 文档与 systemd 模板保持 **host-agnostic**（用占位符 / 环境变量，不写死某台机器路径）。
