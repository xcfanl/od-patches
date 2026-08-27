/** Browser discovery — mirrors apps/daemon/src/browser-sessions.ts (read-only copy). */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function firstExisting(candidates: Array<string | undefined>): string | null {
  return candidates.find((c): c is string => Boolean(c && fs.existsSync(c))) ?? null;
}

function executableFromPath(names: string[]): string | null {
  const pathValue = process.env.PATH || "";
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function findBrowserExecutable(explicit?: string | null): string | null {
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  const configured = process.env.OD_BROWSER_EXECUTABLE_PATH;
  if (configured) return fs.existsSync(configured) ? configured : null;
  if (process.platform === "darwin") {
    return firstExisting([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ]);
  }
  if (process.platform === "win32") {
    const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(
      (v): v is string => Boolean(v),
    );
    return firstExisting(
      roots.flatMap((root) => [
        path.join(root, "Google/Chrome/Application/chrome.exe"),
        path.join(root, "Microsoft/Edge/Application/msedge.exe"),
      ]),
    );
  }
  return executableFromPath([
    "google-chrome-stable",
    "google-chrome",
    "microsoft-edge-stable",
    "microsoft-edge",
    "chromium",
    "chromium-browser",
  ]);
}
