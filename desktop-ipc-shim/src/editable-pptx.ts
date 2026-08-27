/**
 * Editable PPTX export via vendored dom-to-pptx (browser UMD in page context).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

import type { Page } from "puppeteer-core";

import { editablePageFns } from "./editable-page.mjs";
import type { RenderSlidesResult } from "./chrome-renderer.js";

const gunzipAsync = promisify(gunzip);
let cachedDomToPptxBundle: string | null = null;

const GOOGLE_FONT_STYLESHEET_TIMEOUT_MS = 10_000;

async function loadDomToPptxBundle(): Promise<string> {
  if (cachedDomToPptxBundle != null) return cachedDomToPptxBundle;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "../vendor/dom-to-pptx/dom-to-pptx.bundle.js"),
    path.join(here, "../vendor/dom-to-pptx/dom-to-pptx.bundle.js.gz"),
  ];
  for (const candidate of candidates) {
    try {
      const bytes = await readFile(candidate);
      cachedDomToPptxBundle = candidate.endsWith(".gz")
        ? (await gunzipAsync(bytes)).toString("utf8")
        : bytes.toString("utf8");
      return cachedDomToPptxBundle;
    } catch {
      // try next
    }
  }
  throw new Error("dom-to-pptx vendor bundle not found");
}

export async function fetchGoogleFontStylesheets(
  urls: string[],
): Promise<Array<{ cssText: string; url: string }>> {
  const stylesheets: Array<{ cssText: string; url: string }> = [];
  for (const url of urls) {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (new URL(url).hostname !== "fonts.googleapis.com") continue;
      const stylesheet = await Promise.race([
        (async () => {
          const response = await fetch(url, {
            headers: { "user-agent": "Mozilla/5.0" },
            signal: controller.signal,
          });
          if (!response.ok) return null;
          return { cssText: await response.text(), url };
        })(),
        new Promise<null>((resolve) => {
          timeout = setTimeout(() => {
            controller.abort();
            resolve(null);
          }, GOOGLE_FONT_STYLESHEET_TIMEOUT_MS);
        }),
      ]);
      if (stylesheet) stylesheets.push(stylesheet);
    } catch {
      // renderer-side fetch remains fallback
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
  return stylesheets;
}

async function evalFn<T>(page: Page, fn: (...args: never[]) => unknown, ...args: unknown[]): Promise<T> {
  // tsx may inject __name() around nested fns in .mjs imports; stub it in-page.
  const runner = new Function(
    `var __name=function(f){return f}; return (${fn.toString()}).apply(null, ${JSON.stringify(args)});`,
  ) as () => T;
  return page.evaluate(runner);
}

async function evalAsyncFn<T>(
  page: Page,
  fn: (...args: never[]) => unknown,
  ...args: unknown[]
): Promise<T> {
  const runner = new Function(
    `var __name=function(f){return f}; return (${fn.toString()}).apply(null, ${JSON.stringify(args)});`,
  ) as () => Promise<T>;
  return page.evaluate(runner);
}

export async function renderEditablePptx(
  page: Page,
  stage: { w: number; h: number },
  outputDir: string | undefined,
  slideSelector: string,
): Promise<RenderSlidesResult> {
  if (!outputDir) {
    return {
      ok: false,
      error: "editable PPTX requires outputDir (daemon scratch handoff)",
      errorCode: "RENDER_FAILED",
    };
  }

  await evalFn(page, editablePageFns.showAllSlides, slideSelector, stage.w, stage.h);
  try {
    await page.evaluate(() =>
      Promise.resolve(document.fonts?.ready).then(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      ),
    );
  } catch {
    // ignore
  }

  const importedUrls = await evalFn<string[]>(page, editablePageFns.collectImportedStylesheetUrls);
  // Always pull embeddable CJK webfonts. Authored stacks often name PingFang /
  // Microsoft YaHei (not present on Linux render hosts or Windows PPT), which
  // otherwise land in the PPTX as bare typeface names and fall back to 宋体.
  const cjkFallbackStylesheets = [
    "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&display=swap",
    "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap",
    "https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&display=swap",
  ];
  const stylesheetUrls = Array.from(new Set([...importedUrls, ...cjkFallbackStylesheets]));
  const importedStylesheetOverrides = await fetchGoogleFontStylesheets(stylesheetUrls);

  const bundle = await loadDomToPptxBundle();
  await page.addScriptTag({ content: bundle });

  const prepared = await evalAsyncFn<{ error?: string; prepared?: boolean }>(
    page,
    editablePageFns.runDomToPptx,
    slideSelector,
    {},
    "prepare",
    importedStylesheetOverrides,
  );
  if (!prepared?.prepared || prepared.error) {
    return {
      ok: false,
      error: prepared?.error || "editable PPTX export DOM normalization failed",
      errorCode: "RENDER_FAILED",
    };
  }

  const out = await evalAsyncFn<{ b64?: string; error?: string }>(
    page,
    editablePageFns.runDomToPptx,
    slideSelector,
    {},
    "export-prepared",
    importedStylesheetOverrides,
  );
  if (!out?.b64) {
    return {
      ok: false,
      error: out?.error || "editable PPTX export produced no output",
      errorCode: "RENDER_FAILED",
    };
  }

  await mkdir(outputDir, { recursive: true });
  const file = path.join(outputDir, "deck.pptx");
  await writeFile(file, Buffer.from(out.b64, "base64"));
  return {
    ok: true,
    pptxFile: file,
    width: stage.w,
    height: stage.h,
    mode: "deck",
  };
}
