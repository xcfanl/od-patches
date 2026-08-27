# od-desktop-ipc-shim

Out-of-tree **desktop.sock** shim for [OpenDesign](https://github.com/nexu-io/open-design).  
Implements `render-slides` with system Chrome/Chromium so OpenDesign web can export PPTX **without editing upstream sources**.

Repo umbrella: [../README.md](../README.md).

## 为什么存在

上游 OpenDesign 的 Web「导出 PPTX」会经 daemon 打到 **`desktop.sock`**，契约上由 Electron Desktop 用内置 Chromium 做 `render-slides`（截图或可编辑）。在无桌面、无 Electron、或只想跑 headless 服务的环境里，这个 socket 空着，导出直接失败。

本包存在的理由：

1. **不改 upstream** — 继续用官方 Web / daemon；只在旁边挂一个兼容 `desktop.sock` 的进程。
2. **用系统 Chrome** — 以 Puppeteer + 本机 Chrome/Chromium 实现同一 IPC，避免再装一套 Electron。
3. **截图 + 可编辑两条路径** — `editable: false` 出 slide PNG；`editable: true` 走 vendored `dom-to-pptx`，并处理 CJK 字体嵌入等保真问题。
4. **可当系统服务跑** — 适合机房 / CI / 长期在线的 tools-dev，而不是依赖有人开着 Desktop 窗口。

若上游将来内建 headless renderer 且 IPC 契约不变，本包可以退役；在那之前它填的是「Web 能导出、机器上却没有 Desktop」的缺口。

## What it does

Supports:

- **Screenshot PPTX** — per-slide PNGs → daemon stitches
- **Editable PPTX** — vendored `dom-to-pptx` → native text/shapes (`pptxFile` handoff)

## Requirements

| Dependency | Notes |
|------------|--------|
| Node.js ≥ 22 (24 preferred) | On `PATH` as `node` |
| pnpm | For install |
| Chrome or Chromium | `google-chrome-stable`, `chromium`, or set `OD_BROWSER_EXECUTABLE_PATH` |
| OpenDesign checkout | Built `packages/sidecar/dist` + `packages/sidecar-proto/dist` |
| Network (editable) | Google Fonts fetch for CJK embed (Noto Sans SC, etc.) |

Do **not** run Electron OpenDesign desktop on the same IPC namespace (socket conflict).

## Layout

Clone this repo and OpenDesign wherever you like — only env/flags matter:

```text
<any>/od-patches/                 ← this repository (umbrella)
<any>/od-patches/desktop-ipc-shim ← this package
<any>/open-design                 ← OpenDesign (built)
```

Repo overview: [../README.md](../README.md).

Paths below use:

- `$SHIM_ROOT` — absolute path to `desktop-ipc-shim`
- `$OD_ROOT` — absolute path to the OpenDesign checkout

## Install

```bash
cd "$SHIM_ROOT"
pnpm install
```

Vendored engine: `vendor/dom-to-pptx/dom-to-pptx.bundle.js.gz` (browser UMD only; do not `npm install dom-to-pptx`).

## Run (foreground)

Terminal A — OpenDesign (unchanged upstream):

```bash
cd "$OD_ROOT"
pnpm tools-dev run web --prod --web-port 8786
# use the same --namespace as the shim if you set one
```

Terminal B — shim:

```bash
cd "$SHIM_ROOT"
export OD_OPEN_DESIGN_ROOT="$OD_ROOT"
export OD_SIDECAR_NAMESPACE=default          # must match tools-dev
# optional:
# export OD_BROWSER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
# export OD_SHIM_KEEP_BROWSER=1

pnpm start -- --namespace default --keep-browser --open-design-root "$OD_ROOT"
```

Or:

```bash
cd "$SHIM_ROOT"
node --import tsx src/main.ts \
  --namespace default \
  --open-design-root "$OD_ROOT" \
  --keep-browser
```

Confirm the socket (namespace `default`):

```bash
ls -l "${XDG_RUNTIME_DIR:-/tmp}/open-design/ipc/default/desktop.sock" 2>/dev/null \
  || ls -l /tmp/open-design/ipc/default/desktop.sock
```

Then in the web UI: **Export PPTX → screenshot** or **editable**.

### CLI / env

| Flag / env | Meaning |
|------------|---------|
| `--namespace` / `OD_SIDECAR_NAMESPACE` | IPC namespace (must match tools-dev) |
| `--open-design-root` / `OD_OPEN_DESIGN_ROOT` | OpenDesign tree (required unless a sibling `open-design` is found) |
| `--chrome` / `OD_BROWSER_EXECUTABLE_PATH` | Chrome/Chromium binary |
| `--keep-browser` / `OD_SHIM_KEEP_BROWSER=1` | Keep one Chrome warm between jobs |

## Run as a systemd user/system service

Ship a **template** at `systemd/od-desktop-shim.service.example`. Copy and substitute your paths — do not rely on any machine-specific defaults.

```bash
cd "$SHIM_ROOT"
NODE_BIN="$(command -v node)"
cp systemd/od-desktop-shim.service.example /tmp/od-desktop-shim.service

# Replace placeholders (GNU sed). Adjust for your install layout.
sed -i \
  -e "s|@SHIM_ROOT@|${SHIM_ROOT}|g" \
  -e "s|@OD_ROOT@|${OD_ROOT}|g" \
  -e "s|@NODE_BIN@|${NODE_BIN}|g" \
  -e "s|@CHROME_BIN@|${OD_BROWSER_EXECUTABLE_PATH:-/usr/bin/google-chrome-stable}|g" \
  /tmp/od-desktop-shim.service

sudo cp /tmp/od-desktop-shim.service /etc/systemd/system/od-desktop-shim.service
sudo systemctl daemon-reload
sudo systemctl enable --now od-desktop-shim.service
sudo systemctl status od-desktop-shim.service
```

Logs: `journalctl -u od-desktop-shim.service -f`

Stop Electron desktop (or another shim) before starting, or change `OD_SIDECAR_NAMESPACE`.

## Editable PPTX notes

- Stage is fixed **1280×720** (same as screenshot path in this shim).
- Platform CJK faces that cannot be embedded on Linux render hosts (`PingFang SC`, `Microsoft YaHei`, …) are remapped to **Noto Sans SC** (etc.) and **embedded** into the PPTX (`ppt/fonts/*.fntdata`) so Windows/WPS do not fall back to 宋体.
- Inline SVGs are rasterized at **4×** CSS size before export.
- Design detail: `docs/editable-pptx/`.

## Smoke tests

```bash
cd "$SHIM_ROOT"
export OD_OPEN_DESIGN_ROOT="$OD_ROOT"   # only needed if sidecar imports resolve via that root for other tools; smokes use Chrome directly

pnpm smoke                 # screenshot path
pnpm smoke-editable        # editable PPTX ZIP
pnpm exec tsx scripts/smoke-font-remap.ts   # PingFang → Noto + embed
```

## Status

| Feature | Status |
|---------|--------|
| `status` / `shutdown` IPC | done |
| `render-slides` deck screenshot → `slideFiles` | done |
| `render-slides` editable PPTX → `pptxFile` | done (MVP + CJK embed remap) |
| page-mode full capture | basic |
| `stitch` / `export-pdf` / `export-artifact` | not yet |

## Upgrade note

When updating OpenDesign, re-check `DesktopRenderSlides*` / `render-slides` in `sidecar-proto`. This package should not need changes if the IPC contract is stable.
