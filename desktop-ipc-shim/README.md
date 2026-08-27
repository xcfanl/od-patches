# od-desktop-ipc-shim

Out-of-tree **desktop.sock** shim for [OpenDesign](https://github.com/nexu-io/open-design).  
Implements `render-slides` with system Chrome/Chromium so `pnpm tools-dev run web` can export screenshot PPTX **without editing upstream sources**.

Design: `/home/open-design/specs/current/chrome-headless-slide-renderer/patch-strategy.md`

## Requirements

- OpenDesign checkout with built packages: `packages/sidecar/dist`, `packages/sidecar-proto/dist`
- Node ≥ 22 (24 preferred)
- `google-chrome-stable` / Chromium, or `OD_BROWSER_EXECUTABLE_PATH`
- Do **not** run real Electron desktop on the same namespace (sock conflict)

## Install

```bash
cd /home/od-patches/desktop-ipc-shim
pnpm install
```

## Run

```bash
# Terminal A: OpenDesign (unchanged)
cd /home/open-design && pnpm tools-dev run web --prod --web-port 8786

# Terminal B: shim
cd /home/od-patches/desktop-ipc-shim
pnpm start -- --namespace default --keep-browser
```

Or:

```bash
node --import tsx src/main.ts --namespace default --keep-browser
```

Confirm sock:

```bash
ls -l /tmp/open-design/ipc/default/desktop.sock
```

Then use the web UI **Export PPTX → screenshot** (editable is not implemented yet).

## systemd

```bash
sudo cp systemd/od-desktop-shim.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now od-desktop-shim.service
sudo systemctl status od-desktop-shim.service
```

Adjust `ExecStart` Node path and `OD_OPEN_DESIGN_ROOT` if needed.

## Options

| Flag / env | Meaning |
|------------|---------|
| `--namespace` / `OD_SIDECAR_NAMESPACE` | Must match tools-dev namespace |
| `--open-design-root` / `OD_OPEN_DESIGN_ROOT` | OpenDesign tree (for sidecar dist imports) |
| `--chrome` / `OD_BROWSER_EXECUTABLE_PATH` | Browser binary |
| `--keep-browser` / `OD_SHIM_KEEP_BROWSER=1` | Warm Chrome between jobs |

## Status

| Feature | Status |
|---------|--------|
| `status` / `shutdown` IPC | done |
| `render-slides` deck screenshot → `slideFiles` | done |
| page-mode full capture | basic |
| editable PPTX (`dom-to-pptx`) | not yet |
| `stitch` / `export-pdf` / `export-artifact` | not yet |

## Upgrade note

When pulling OpenDesign, re-check `DesktopRenderSlides*` / `render-slides` in `sidecar-proto`. This package should not need changes if the IPC contract is stable.
