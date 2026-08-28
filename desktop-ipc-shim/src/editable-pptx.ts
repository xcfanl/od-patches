/**
 * Editable PPTX export via vendored dom-to-pptx (browser UMD in page context).
 */

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import type { Page } from "puppeteer-core";

import { editablePageFns } from "./editable-page.mjs";
import type { RenderSlidesResult } from "./chrome-renderer.js";

const gunzipAsync = promisify(gunzip);
const execFileAsync = promisify(execFile);
let cachedDomToPptxBundle: string | null = null;

const FLATTEN_PPTX_SVG_SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../scripts/flatten-pptx-svg.py",
);

/** Optional keep-dir outside daemon scratch — scratch is always deleted in finally. */
function keepExportDir(): string | null {
  const fromEnv = process.env.OD_SHIM_KEEP_EXPORT_DIR?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

function keepExportFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `editable-${stamp}.pptx`;
}

async function retainEditableExportCopy(pptxFile: string): Promise<string | null> {
  const dir = keepExportDir();
  if (!dir) return null;
  try {
    await mkdir(dir, { recursive: true });
    const dest = path.join(dir, keepExportFileName());
    await copyFile(pptxFile, dest);
    console.info("[shim] kept editable PPTX copy", dest);
    return dest;
  } catch (err) {
    console.warn(
      "[shim] failed to keep editable PPTX copy:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Drop Office svgBlip dual-embeds (PNG+SVG). WPS / older PPT often treat them
 * as package damage when many images/borders are present.
 */
async function flattenPptxSvgBlips(pptxFile: string): Promise<void> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "python3",
      [FLATTEN_PPTX_SVG_SCRIPT, pptxFile],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const line = String(stdout || stderr || "").trim();
    if (line) console.info("[shim] flattened svgBlips", line);
  } catch (err) {
    console.warn(
      "[shim] svgBlip flatten failed (export kept as-is):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Inject speaker-notes hook after each `pptx.addSlide()` in the vendored exporter. */
function patchDomToPptxBundleForNotes(source: string): string {
  const needle = "const slide = pptx.addSlide();";
  const injection =
    'const slide = pptx.addSlide();' +
    'if(typeof globalThis.__odPptxSlideNotes==="function"){' +
    'var __odNotes=globalThis.__odPptxSlideNotes(slideIndex);' +
    'if(__odNotes)slide.addNotes(__odNotes);' +
    '}';
  if (!source.includes(needle)) {
    console.warn("[shim] dom-to-pptx bundle missing addSlide hook point; speaker notes skipped");
    return source;
  }
  if (source.includes("__odPptxSlideNotes")) return source;
  return source.split(needle).join(injection);
}

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
      const raw = candidate.endsWith(".gz")
        ? (await gunzipAsync(bytes)).toString("utf8")
        : bytes.toString("utf8");
      cachedDomToPptxBundle = patchDomToPptxBundleForNotes(raw);
      return cachedDomToPptxBundle;
    } catch {
      // try next
    }
  }
  throw new Error("dom-to-pptx vendor bundle not found");
}

const GOOGLE_FONT_STYLESHEET_TIMEOUT_MS = 10_000;

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

/**
 * Fetch <img> bitmaps in Node and rewrite to data: URLs.
 *
 * Export runs in a setContent/data: document (origin "null"). dom-to-pptx sets
 * crossOrigin=Anonymous before canvas draw; without CORS the photo never lands
 * in the PPTX. Materializing first makes canvas same-origin.
 */
async function materializeRasterImages(page: Page): Promise<number> {
  const urls = await page.evaluate(() => {
    const out = new Set<string>();
    document.querySelectorAll("img[src]").forEach((node) => {
      const img = node as HTMLImageElement;
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith("data:")) return;
      if (/\.svg(\?|#|$)/i.test(src)) return;
      out.add(src);
    });
    return Array.from(out);
  });
  if (urls.length === 0) return 0;

  const map: Record<string, string> = {};
  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const mime = (res.headers.get("content-type") || "application/octet-stream")
          .split(";")[0]!
          .trim();
        if (!mime.startsWith("image/")) return;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength < 32) return;
        map[url] = `data:${mime};base64,${buf.toString("base64")}`;
      } catch {
        // leave remote src; export may still work if CORS is present
      }
    }),
  );

  const count = Object.keys(map).length;
  if (count === 0) return 0;

  await page.evaluate((replacements) => {
    document.querySelectorAll("img[src]").forEach((node) => {
      const img = node as HTMLImageElement;
      const src = img.currentSrc || img.src;
      const next = replacements[src];
      if (!next) return;
      img.removeAttribute("crossorigin");
      img.src = next;
    });
  }, map);

  await page.evaluate(async () => {
    await Promise.all(
      Array.from(document.images).map((img) =>
        img.decode ? img.decode().catch(() => undefined) : Promise.resolve(),
      ),
    );
  });

  console.info("[shim] materialized raster images", count);
  return count;
}

/**
 * Bake .slide-bg (photo + ::after dimming overlay) into one PNG.
 * dom-to-pptx drops gradient-only ::after pseudos, which destroys the designed
 * contrast structure on photo-backed slides.
 *
 * Slides are stacked at (0,0) during export, so each capture must isolate its
 * owning slide or every screenshot paints the topmost slide.
 */
async function rasterizeSlideBackgroundLayers(
  page: Page,
  slideSelector: string,
): Promise<number> {
  // slideSelector may be a comma-list (".slide, .deck-slide, …"); build a safe
  // descendant selector so we don't match the slides themselves.
  const bgSelector = slideSelector
    .split(",")
    .map((part) => `${part.trim()} .slide-bg`)
    .filter(Boolean)
    .join(", ");

  const count = await page.$$eval(bgSelector, (els) => {
    els.forEach((el, i) => el.setAttribute("data-od-pptx-bg-idx", String(i)));
    return els.length;
  });
  if (count === 0) return 0;

  let flattened = 0;
  for (let i = 0; i < count; i++) {
    const idx = String(i);
    try {
      await page.evaluate(
        (sel, index) => {
          const target = document.querySelector(
            `.slide-bg[data-od-pptx-bg-idx="${index}"]`,
          ) as HTMLElement | null;
          if (!target) return;
          const slide = target.closest(sel) as HTMLElement | null;
          document.querySelectorAll(sel).forEach((node) => {
            const el = node as HTMLElement;
            if (el === slide) {
              el.style.setProperty("visibility", "visible", "important");
              el.style.setProperty("opacity", "1", "important");
              return;
            }
            el.setAttribute("data-od-pptx-iso-hide", "1");
            el.style.setProperty("visibility", "hidden", "important");
          });
        },
        slideSelector,
        idx,
      );

      const handle = await page.$(`.slide-bg[data-od-pptx-bg-idx="${idx}"]`);
      if (!handle) continue;
      try {
        const already = await handle.evaluate(
          (el) => el.getAttribute("data-od-pptx-bg-flat") === "1",
        );
        if (already) continue;
        const box = await handle.boundingBox();
        if (!box || box.width < 2 || box.height < 2) continue;
        const shot = await handle.screenshot({ type: "png" });
        const dataUrl = `data:image/png;base64,${Buffer.from(shot).toString("base64")}`;
        await handle.evaluate((el, url) => {
          el.setAttribute("data-od-pptx-bg-flat", "1");
          while (el.firstChild) el.removeChild(el.firstChild);
          el.style.setProperty("background", "none", "important");
          el.style.setProperty("background-image", "none", "important");
          const img = document.createElement("img");
          img.setAttribute("data-od-pptx-slide-bg", "1");
          img.alt = "";
          img.src = url;
          img.style.cssText =
            "display:block;width:100%;height:100%;object-fit:fill;margin:0;padding:0;border:0;";
          el.appendChild(img);
        }, dataUrl);
        flattened++;
      } finally {
        await handle.dispose().catch(() => undefined);
      }
    } catch (err) {
      console.warn(
        "[shim] slide-bg flatten failed:",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      await page.evaluate(() => {
        document.querySelectorAll('[data-od-pptx-iso-hide="1"]').forEach((node) => {
          const el = node as HTMLElement;
          el.removeAttribute("data-od-pptx-iso-hide");
          el.style.setProperty("visibility", "visible", "important");
        });
      });
    }
  }

  if (flattened > 0) console.info("[shim] flattened slide-bg layers", flattened);
  return flattened;
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

  await materializeRasterImages(page);

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

  // After prepare geometry is stable: bake photo + overlay into one picture.
  await rasterizeSlideBackgroundLayers(page, slideSelector);

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
  await flattenPptxSvgBlips(file);
  await retainEditableExportCopy(file);
  return {
    ok: true,
    pptxFile: file,
    width: stage.w,
    height: stage.h,
    mode: "deck",
  };
}
