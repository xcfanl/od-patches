/**
 * Chrome / Chromium headless implementation of DesktopRenderSlides*.
 * Screenshot + editable PPTX (dom-to-pptx) via system Chrome.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import puppeteer, { type Browser, type Page } from "puppeteer-core";

import { renderEditablePptx } from "./editable-pptx.js";
import { findBrowserExecutable } from "./find-browser.js";
import {
  DECK_STAGE_SELECTOR,
  HIDE_CHROME_SELECTOR,
  SLIDE_H,
  SLIDE_SELECTOR,
  SLIDE_W,
  injectBaseHref,
  pageFns,
  shouldCaptureAsDeck,
} from "./page-scripts.mjs";

export type RenderSlidesInput = {
  baseHref?: string;
  html: string;
  deck?: boolean;
  editable?: boolean;
  index?: number;
  pageImageFormat?: "png" | "jpeg";
  stitch?: boolean;
  paginate?: boolean;
  outputDir?: string;
};

export type RenderSlidesResult = {
  ok: boolean;
  error?: string;
  errorCode?: "NO_SLIDES" | "PAGE_TOO_TALL" | "RENDER_FAILED" | "SLIDE_INDEX_OUT_OF_RANGE";
  height?: number;
  mode?: "deck" | "page";
  pptxFile?: string;
  slideFiles?: string[];
  slides?: string[];
  width?: number;
};

export type ChromeRendererOptions = {
  executablePath?: string | null;
  /** Reuse one browser across jobs when set by main. */
  sharedBrowser?: Browser | null;
};

async function launchBrowser(executablePath: string): Promise<Browser> {
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--font-render-hinting=none",
      "--hide-scrollbars",
    ],
  });
}

async function emitImages(
  images: Array<{ buffer: Buffer; jpeg: boolean }>,
  outputDir: string | undefined,
): Promise<Pick<RenderSlidesResult, "slideFiles" | "slides">> {
  if (outputDir) {
    await mkdir(outputDir, { recursive: true });
    const slideFiles: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i]!;
      const file = path.join(outputDir, `slide-${i}.${img.jpeg ? "jpeg" : "png"}`);
      await writeFile(file, img.buffer);
      slideFiles.push(file);
    }
    return { slideFiles };
  }
  return {
    slides: images.map((img) => {
      const mime = img.jpeg ? "image/jpeg" : "image/png";
      return `data:${mime};base64,${img.buffer.toString("base64")}`;
    }),
  };
}

/** Evaluate a pageFn without tsx/esbuild __name helpers leaking into Chromium. */
async function evalFn<T>(page: Page, fn: (...args: never[]) => unknown, ...args: unknown[]): Promise<T> {
  // Build the runner in Node with new Function so Puppeteer serializes a clean
  // `function anonymous(){ return (fn).apply(...) }` — never pass a tsx-wrapped
  // closure into page.evaluate (that injects __name). Stub __name for nested
  // helpers that tsx still rewrites inside .mjs pageFns.
  const runner = new Function(
    `var __name=function(f){return f}; return (${fn.toString()}).apply(null, ${JSON.stringify(args)});`,
  ) as () => T;
  return page.evaluate(runner);
}

async function waitForContent(page: Page): Promise<void> {
  try {
    await evalFn(page, pageFns.waitFontsAndFrames);
  } catch {
    // ignore
  }
  // Give late images a short window without blocking forever on broken URLs.
  await Promise.race([
    page.waitForNetworkIdle({ idleTime: 200, timeout: 8_000 }).catch(() => undefined),
    new Promise((r) => setTimeout(r, 1_500)),
  ]);
}

async function captureViewport(page: Page, jpeg: boolean, stage: { w: number; h: number }): Promise<Buffer> {
  const buf = await page.screenshot({
    type: jpeg ? "jpeg" : "png",
    ...(jpeg ? { quality: 82 } : {}),
    // Exact stage clip — matches Electron CDP captureDeckSlide (avoids capturing
    // letterboxed / scaled leftovers outside the authored canvas).
    clip: { x: 0, y: 0, width: stage.w, height: stage.h },
    captureBeyondViewport: false,
  });
  return Buffer.from(buf);
}

async function renderWithPage(page: Page, input: RenderSlidesInput): Promise<RenderSlidesResult> {
  const doc = injectBaseHref(input.html, input.baseHref);
  await page.setViewport({
    width: SLIDE_W,
    height: SLIDE_H,
    deviceScaleFactor: 1,
  });

  // Prefer navigating baseHref host when present so relative assets resolve;
  // setContent with <base> also works for data-only decks.
  await page.setContent(doc, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForContent(page);

  const count = await evalFn<number>(page, pageFns.countRealSlides, SLIDE_SELECTOR);
  const hasSlides = Number.isInteger(count) && count >= 1;
  if (input.deck === true && !hasSlides) {
    return { ok: false, error: "no slide surfaces found in this deck", errorCode: "NO_SLIDES" };
  }

  const wantsDeck = shouldCaptureAsDeck(hasSlides, input.deck);
  const jpeg = input.pageImageFormat === "jpeg";

  if (!wantsDeck) {
    // Full-page capture (simplified — no paginate stitch yet).
    const metrics = await evalFn<{ w: number; h: number }>(page, pageFns.pageMetrics);
    const w = Math.min(Math.max(metrics.w, 320), 4096);
    const h = Math.min(Math.max(metrics.h, 320), 16_000);
    if (h > 30_000) {
      return { ok: false, error: "page too tall for capture", errorCode: "PAGE_TOO_TALL" };
    }
    await page.setViewport({ width: w, height: Math.min(h, 4096), deviceScaleFactor: 1 });
    const buffer = await page.screenshot({
      type: jpeg ? "jpeg" : "png",
      ...(jpeg ? { quality: 82 } : {}),
      fullPage: true,
    });
    return {
      ok: true,
      mode: "page",
      width: w,
      height: h,
      ...(await emitImages([{ buffer: Buffer.from(buffer), jpeg }], input.outputDir)),
    };
  }

  await evalFn(page, pageFns.prepareDeckStage, HIDE_CHROME_SELECTOR, DECK_STAGE_SELECTOR);

  const stage = { w: SLIDE_W, h: SLIDE_H };

  await page.setViewport({ width: stage.w, height: stage.h, deviceScaleFactor: 1 });
  await evalFn(page, pageFns.waitFontsAndFrames);

  const useScrollCarousel = await evalFn<boolean>(page, pageFns.isHorizontalScrollCarousel, SLIDE_SELECTOR);

  if (useScrollCarousel) {
    const pinned = await evalFn<boolean>(
      page,
      pageFns.pinCarouselSlidesForExport,
      SLIDE_SELECTOR,
      stage.w,
      stage.h,
    );
    if (!pinned) {
      await evalFn(page, pageFns.prepareScrollCarouselExport);
    }
  } else {
    await evalFn(page, pageFns.pinDeckStage, stage.w, stage.h, DECK_STAGE_SELECTOR);
    await evalFn(page, pageFns.lockExportGeometry, stage.w, stage.h, SLIDE_SELECTOR, DECK_STAGE_SELECTOR);
  }
  await evalFn(page, pageFns.waitFontsAndFrames);

  if (input.editable) {
    return renderEditablePptx(page, stage, input.outputDir, SLIDE_SELECTOR);
  }

  if (input.index != null && (input.index < 0 || input.index >= count)) {
    return {
      ok: false,
      error: `slide index ${input.index} is out of range (deck has ${count} slide(s))`,
      errorCode: "SLIDE_INDEX_OUT_OF_RANGE",
    };
  }

  const indices = input.index != null ? [input.index] : Array.from({ length: count }, (_, i) => i);
  const images: Array<{ buffer: Buffer; jpeg: boolean }> = [];
  let width = stage.w;
  let height = stage.h;

  for (const i of indices) {
    if (useScrollCarousel) {
      const rect = await evalFn<{ x: number; y: number; w: number; h: number } | null>(
        page,
        pageFns.showSlide,
        SLIDE_SELECTOR,
        i,
      );
      const onStage =
        rect != null &&
        Math.abs(rect.x) <= 2 &&
        Math.abs(rect.y) <= 2 &&
        rect.w >= stage.w * 0.92 &&
        rect.h >= stage.h * 0.92;
      if (!onStage) {
        await evalFn(page, pageFns.restackActiveSlide, SLIDE_SELECTOR, i, stage.w, stage.h);
        await evalFn(page, pageFns.waitFontsAndFrames);
      }
      await evalFn(page, pageFns.forceSlideFillStage, SLIDE_SELECTOR, i, stage.w, stage.h);
    } else {
      const rect = await evalFn<{ x: number; y: number; w: number; h: number } | null>(
        page,
        pageFns.showSlide,
        SLIDE_SELECTOR,
        i,
      );
      const onStage =
        rect != null &&
        Math.abs(rect.x) <= 2 &&
        Math.abs(rect.y) <= 2 &&
        rect.w >= stage.w * 0.5 &&
        rect.h >= stage.h * 0.5;
      if (!onStage) {
        await evalFn(page, pageFns.restackActiveSlide, SLIDE_SELECTOR, i, stage.w, stage.h);
        await evalFn(page, pageFns.waitFontsAndFrames);
      }
      await evalFn(page, pageFns.forceSlideFillStage, SLIDE_SELECTOR, i, stage.w, stage.h);
    }
    await evalFn(page, pageFns.waitFontsAndFrames);
    const buffer = await captureViewport(page, jpeg, stage);
    images.push({ buffer, jpeg });
    width = stage.w;
    height = stage.h;
  }

  if (input.stitch && images.length > 1) {
    // Minimal stitch: return first slide only with error — stitch needs sharp/canvas.
    // Prefer sequential files; daemon image export with stitch can wait for Phase 2.
    // For now concatenate is not implemented; capture all and let caller use non-stitch.
    return {
      ok: false,
      error: "stitch mode is not implemented in od-desktop-ipc-shim yet",
      errorCode: "RENDER_FAILED",
    };
  }

  return {
    ok: true,
    mode: "deck",
    width,
    height,
    ...(await emitImages(images, input.outputDir)),
  };
}

export async function renderSlides(
  input: RenderSlidesInput,
  options: ChromeRendererOptions = {},
): Promise<RenderSlidesResult> {
  const executablePath = findBrowserExecutable(options.executablePath ?? null);
  if (!executablePath) {
    return {
      ok: false,
      error:
        "No Chrome/Chromium found. Install google-chrome-stable or set OD_BROWSER_EXECUTABLE_PATH.",
      errorCode: "RENDER_FAILED",
    };
  }

  const ownsBrowser = !options.sharedBrowser;
  const browser = options.sharedBrowser ?? (await launchBrowser(executablePath));
  let page: Page | null = null;
  try {
    page = await browser.newPage();
    return await renderWithPage(page, input);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      errorCode: "RENDER_FAILED",
    };
  } finally {
    if (page) await page.close().catch(() => undefined);
    if (ownsBrowser) await browser.close().catch(() => undefined);
  }
}

export { launchBrowser };
