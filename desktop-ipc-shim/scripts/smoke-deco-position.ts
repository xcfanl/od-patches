/**
 * Smoke: absolute decorative SVGs (corner / watermark) stay pinned after
 * SVG→PNG rasterize — must not collapse into normal flow beside title/body.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { renderSlides } from "../src/chrome-renderer.js";

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  :root { --accent: #3760ea; --border: #ebebeb; --bg: #ffffff; --fg: #111111; }
  body { margin: 0; }
  .slide {
    width: 1280px; height: 720px; position: relative; overflow: hidden;
    box-sizing: border-box; padding: 72px 88px 64px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: var(--bg); color: var(--fg); text-align: center;
    font-family: sans-serif;
  }
  .deco-mark {
    position: absolute; right: -40px; bottom: -40px;
    width: 220px; height: auto; opacity: 0.12; z-index: 0; pointer-events: none;
  }
  .deco-corner {
    position: absolute; top: 0; right: 0;
    width: 140px; height: 140px; opacity: 0.75; z-index: 0; pointer-events: none;
  }
  .slide > *:not(.deco-mark):not(.deco-corner) { position: relative; z-index: 1; }
  h1 { margin: 0 0 16px; font-size: 48px; }
  p { margin: 0; font-size: 20px; max-width: 36em; }
</style>
</head>
<body>
  <section class="slide">
    <svg class="deco-mark" viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" fill="var(--accent)"/>
    </svg>
    <svg class="deco-corner" viewBox="0 0 100 100" aria-hidden="true">
      <path d="M100 0H40M100 0V60" stroke="var(--accent)" stroke-width="4" fill="none"/>
      <circle cx="100" cy="0" r="8" fill="var(--accent)"/>
    </svg>
    <h1>Cover Title</h1>
    <p>Body copy should sit above decorative layers, not after them in a column.</p>
  </section>
</body>
</html>`;

/** EMU helpers — slide canvas from engine is typically ~9144000×5143500 (10"×5.625"). */
function parsePicOffsets(slideXml: string): Array<{ x: number; y: number; cx: number; cy: number }> {
  const pics: Array<{ x: number; y: number; cx: number; cy: number }> = [];
  const re =
    /<p:pic>[\s\S]*?<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(-?\d+)" cy="(-?\d+)"\/>[\s\S]*?<\/p:pic>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(slideXml)) !== null) {
    pics.push({
      x: Number(m[1]),
      y: Number(m[2]),
      cx: Number(m[3]),
      cy: Number(m[4]),
    });
  }
  return pics;
}

async function main() {
  const out = await mkdtemp(path.join(tmpdir(), "od-deco-pos-"));
  try {
    const result = await renderSlides({
      html,
      deck: true,
      editable: true,
      outputDir: out,
    });
    if (!result.ok || !result.pptxFile) {
      console.error("FAIL", result);
      process.exit(1);
    }
    const unzipped = path.join(out, "unzipped");
    execFileSync("bash", [
      "-lc",
      `mkdir -p "${unzipped}" && unzip -q -o "${result.pptxFile}" -d "${unzipped}"`,
    ]);
    const slideXml = await readFile(path.join(unzipped, "ppt/slides/slide1.xml"), "utf8");
    const pics = parsePicOffsets(slideXml);
    if (pics.length < 2) {
      console.error("FAIL: expected ≥2 pictures (deco-mark + deco-corner), got", pics.length);
      process.exit(1);
    }

    // Slide ~10" wide / 5.625" tall in EMUs (engine uses 9144000 × 5143500).
    const slideW = 9144000;
    const slideH = 5143500;
    const midX = slideW / 2;
    const midY = slideH / 2;

    const cornerLike = pics.find((p) => p.x > midX && p.y < midY * 0.35 && p.cx < slideW * 0.25);
    const markLike = pics.find(
      (p) => p.x > midX * 0.55 && p.y > midY * 0.55 && p.cx > slideW * 0.12,
    );

    if (!cornerLike) {
      console.error("FAIL: no top-right deco picture", pics);
      process.exit(1);
    }
    if (!markLike) {
      console.error("FAIL: no bottom-right watermark picture", pics);
      process.exit(1);
    }

    // Regression: both decos stacked in the content column (same x band as title center).
    const stackedAsFlow = pics.every((p) => Math.abs(p.x + p.cx / 2 - midX) < slideW * 0.12);
    if (stackedAsFlow) {
      console.error("FAIL: all pictures centered like flow content", pics);
      process.exit(1);
    }

    console.log("OK deco position", {
      corner: cornerLike,
      mark: markLike,
      pics,
    });
  } finally {
    await rm(out, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
