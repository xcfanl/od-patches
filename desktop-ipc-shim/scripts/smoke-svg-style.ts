/**
 * Smoke: inline SVG with CSS variables / currentColor survives editable export
 * as styled PNG (no bare svgBlip dual-embeds).
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
  .slide { width: 1280px; height: 720px; position: relative; background: var(--bg); color: var(--fg); }
  .ic { width: 80px; height: 80px; color: var(--accent); }
  .ic svg { width: 100%; height: 100%; display: block; }
  .art { width: 320px; height: 200px; }
</style>
</head>
<body>
  <section class="slide">
    <div class="ic" data-od-id="icon">
      <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.6"
           stroke-linecap="round" stroke-linejoin="round">
        <circle cx="20" cy="14" r="5"></circle>
        <path d="M8 32c2.5-6 7-9 12-9s9.5 3 12 9"></path>
      </svg>
    </div>
    <div class="art" data-od-id="art">
      <svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
        <g stroke="var(--border)" stroke-width="1">
          <path d="M20 20h280M20 100h280M20 180h280"></path>
        </g>
        <g stroke="var(--accent)" stroke-width="2" fill="var(--bg)">
          <path d="M160 30l50 20v40c0 30-20 50-50 60-30-10-50-30-50-60V50l50-20z"></path>
        </g>
      </svg>
    </div>
  </section>
</body>
</html>`;

async function main() {
  const out = await mkdtemp(path.join(tmpdir(), "od-svg-style-"));
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
    const media = path.join(unzipped, "ppt/media");
    const listing = execFileSync("bash", ["-lc", `ls -1 "${media}" 2>/dev/null || true`], {
      encoding: "utf8",
    });
    const names = listing.split("\n").filter(Boolean);
    const svgs = names.filter((n) => n.endsWith(".svg"));
    if (svgs.length > 0) {
      console.error("FAIL: expected no .svg media after flatten, got", svgs);
      process.exit(1);
    }
    const slideXml = await readFile(path.join(unzipped, "ppt/slides/slide1.xml"), "utf8");
    if (slideXml.includes("svgBlip")) {
      console.error("FAIL: svgBlip still present in slide1.xml");
      process.exit(1);
    }
    const pngs = names.filter((n) => n.endsWith(".png"));
    if (pngs.length < 1) {
      console.error("FAIL: expected raster PNGs", listing);
      process.exit(1);
    }
    let bestNont = 0;
    for (const name of pngs) {
      const probe = path.join(media, name);
      const nont = Number(
        execFileSync(
          "python3",
          [
            "-c",
            "from PIL import Image; import sys\n"
              + "im=Image.open(sys.argv[1])\n"
              + "print(sum(1 for px in im.getdata() if (px[3] if len(px)>3 else 255)>10))",
            probe,
          ],
          { encoding: "utf8" },
        ).trim(),
      );
      if (nont > bestNont) bestNont = nont;
    }
    if (bestNont < 20) {
      console.error("FAIL: PNGs look empty (style loss?)", "bestNont", bestNont);
      process.exit(1);
    }
    console.log("ok", result.pptxFile, "pngs", pngs.length, "bestNont", bestNont);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
