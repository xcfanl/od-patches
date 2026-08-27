/**
 * od-desktop-ipc-shim — occupies OpenDesign desktop.sock and serves render-slides
 * via system Chrome. Does not modify open-design sources.
 */

import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { launchBrowser, renderSlides, type RenderSlidesInput } from "./chrome-renderer.js";
import { findBrowserExecutable } from "./find-browser.js";

type SidecarModules = {
  createJsonIpcServer: (opts: {
    handler: (message: unknown) => unknown | Promise<unknown>;
    socketPath: string;
  }) => Promise<{ close(): Promise<void> }>;
  resolveAppIpcPath: (opts: {
    app: string;
    contract: unknown;
    namespace?: string;
    env?: NodeJS.ProcessEnv;
  }) => string;
  OPEN_DESIGN_SIDECAR_CONTRACT: unknown;
  SIDECAR_MESSAGES: {
    STATUS: string;
    SHUTDOWN: string;
    RENDER_SLIDES: string;
    EXPORT_PDF: string;
    EXPORT_ARTIFACT: string;
  };
  normalizeDesktopSidecarMessage: (input: unknown) => {
    type: string;
    input?: unknown;
  };
};

function parseArgs(argv: string[]): {
  namespace: string;
  openDesignRoot: string;
  chrome: string | null;
  keepBrowser: boolean;
} {
  let namespace = process.env.OD_SIDECAR_NAMESPACE || process.env.OD_NAMESPACE || "default";
  let openDesignRoot = process.env.OD_OPEN_DESIGN_ROOT || "/home/open-design";
  let chrome: string | null = process.env.OD_BROWSER_EXECUTABLE_PATH || null;
  let keepBrowser = process.env.OD_SHIM_KEEP_BROWSER === "1";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--namespace" && argv[i + 1]) namespace = argv[++i]!;
    else if (a === "--open-design-root" && argv[i + 1]) openDesignRoot = argv[++i]!;
    else if (a === "--chrome" && argv[i + 1]) chrome = argv[++i]!;
    else if (a === "--keep-browser") keepBrowser = true;
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    }
  }
  return { namespace, openDesignRoot, chrome, keepBrowser };
}

function printHelp(): void {
  console.log(`od-desktop-ipc-shim — Chrome headless desktop.sock for OpenDesign exports

Usage:
  od-desktop-ipc-shim [options]

Options:
  --namespace <name>         IPC namespace (default: default / OD_SIDECAR_NAMESPACE)
  --open-design-root <path>  OpenDesign checkout (default: /home/open-design)
  --chrome <path>            Chrome/Chromium binary (or OD_BROWSER_EXECUTABLE_PATH)
  --keep-browser             Keep one Chrome process warm between jobs
  -h, --help                 Show help

Does not modify open-design. Stop real Electron desktop before starting.
`);
}

async function loadSidecar(openDesignRoot: string): Promise<SidecarModules> {
  const sidecarUrl = pathToFileURL(path.join(openDesignRoot, "packages/sidecar/dist/index.mjs")).href;
  const protoUrl = pathToFileURL(path.join(openDesignRoot, "packages/sidecar-proto/dist/index.mjs")).href;
  const sidecar = (await import(sidecarUrl)) as SidecarModules;
  const proto = (await import(protoUrl)) as SidecarModules;
  return {
    createJsonIpcServer: sidecar.createJsonIpcServer,
    resolveAppIpcPath: sidecar.resolveAppIpcPath,
    OPEN_DESIGN_SIDECAR_CONTRACT: proto.OPEN_DESIGN_SIDECAR_CONTRACT,
    SIDECAR_MESSAGES: proto.SIDECAR_MESSAGES,
    normalizeDesktopSidecarMessage: proto.normalizeDesktopSidecarMessage,
  };
}

async function assertDist(openDesignRoot: string): Promise<void> {
  for (const rel of ["packages/sidecar/dist/index.mjs", "packages/sidecar-proto/dist/index.mjs"]) {
    const p = path.join(openDesignRoot, rel);
    try {
      await access(p, fsConstants.R_OK);
    } catch {
      throw new Error(`Missing ${p}. Build open-design packages or set --open-design-root.`);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await assertDist(args.openDesignRoot);

  const chromePath = findBrowserExecutable(args.chrome);
  if (!chromePath) {
    console.error("[shim] no Chrome/Chromium found; set --chrome or OD_BROWSER_EXECUTABLE_PATH");
    process.exit(2);
  }
  console.info("[shim] browser", chromePath);

  const mods = await loadSidecar(args.openDesignRoot);
  const socketPath = mods.resolveAppIpcPath({
    app: "desktop",
    contract: mods.OPEN_DESIGN_SIDECAR_CONTRACT,
    namespace: args.namespace,
    env: process.env,
  });
  console.info("[shim] binding", { namespace: args.namespace, socketPath });

  let sharedBrowser = args.keepBrowser ? await launchBrowser(chromePath) : null;
  let ipc: { close(): Promise<void> } | null = null;
  let stopping = false;

  const shutdown = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    try {
      await ipc?.close();
    } catch {
      // ignore
    }
    try {
      await sharedBrowser?.close();
    } catch {
      // ignore
    }
    process.exit(code);
  };

  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));

  const M = mods.SIDECAR_MESSAGES;

  ipc = await mods.createJsonIpcServer({
    socketPath,
    handler: async (message) => {
      const request = mods.normalizeDesktopSidecarMessage(message);
      console.info("[shim] ipc", request.type);
      switch (request.type) {
        case M.STATUS:
          return {
            pid: process.pid,
            state: "running",
            updatedAt: new Date().toISOString(),
            url: null,
            shim: "od-desktop-ipc-shim",
            browser: chromePath,
          };
        case M.SHUTDOWN:
          setImmediate(() => void shutdown(0));
          return { accepted: true };
        case M.RENDER_SLIDES: {
          const input = request.input as RenderSlidesInput;
          const t0 = Date.now();
          const result = await renderSlides(input, {
            executablePath: chromePath,
            sharedBrowser,
          });
          console.info("[shim] render-slides done", {
            ok: result.ok,
            mode: result.mode,
            slides: (result.slideFiles ?? result.slides ?? []).length,
            ms: Date.now() - t0,
            error: result.error,
          });
          return result;
        }
        case M.EXPORT_PDF:
        case M.EXPORT_ARTIFACT:
          throw new Error(
            `od-desktop-ipc-shim does not implement ${request.type} yet (screenshot PPTX via render-slides only)`,
          );
        default:
          throw new Error(`od-desktop-ipc-shim: unsupported desktop sidecar message: ${request.type}`);
      }
    },
  });

  console.info("[shim] listening — PPTX screenshot export should work without Electron");
}

main().catch((error) => {
  console.error("[shim] fatal", error instanceof Error ? error.message : error);
  process.exit(1);
});
