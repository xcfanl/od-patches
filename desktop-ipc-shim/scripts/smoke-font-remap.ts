/**
 * Smoke: PingFang / YaHei should remap to embeddable Noto Sans SC.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

import { renderSlides } from "../src/chrome-renderer.js";

async function main(): Promise<void> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0}
.slide{width:1280px;height:720px;box-sizing:border-box;background:#fff;padding:80px;font-family:"PingFang SC","Microsoft YaHei",sans-serif}
h1{margin:0;font-size:54px;font-weight:700;color:#121C23;line-height:1.2}
p{margin:24px 0 0;font-size:28px;color:#333;line-height:1.5;max-width:900px}
</style></head><body>
<section class="slide"><h1>信息安全，人人有责。</h1><p>这是一段用于检查文本框宽高与字体嵌入的说明文字，宽度应接近设计稿。</p></section>
</body></html>`;

  const out = await mkdtemp(path.join(tmpdir(), "od-font-"));
  try {
    const result = await renderSlides({ html, deck: true, editable: true, outputDir: out });
    console.log("ok", result.ok, result.pptxFile, result.error || "");
    if (!result.ok || !result.pptxFile) process.exit(1);
    const unzipped = path.join(out, "x");
    execSync(`mkdir -p "${unzipped}" && unzip -q -o "${result.pptxFile}" -d "${unzipped}"`);
    const slide = await readFile(path.join(unzipped, "ppt/slides/slide1.xml"), "utf8");
    const faces = [...slide.matchAll(/typeface="([^"]+)"/g)].map((m) => m[1]);
    console.log("typefaces", [...new Set(faces)]);
    console.log("hasPingFang", /PingFang/i.test(slide));
    console.log("hasNoto", /Noto Sans SC/i.test(slide));
    const fontsDir = path.join(unzipped, "ppt/fonts");
    try {
      console.log(
        "embeddedFonts",
        execSync(`ls "${fontsDir}" 2>/dev/null | head`).toString().trim() || "(none)",
      );
    } catch {
      console.log("embeddedFonts (none)");
    }
    const exts = [...slide.matchAll(/<a:ext cx="(\d+)" cy="(\d+)"/g)].slice(0, 5);
    console.log(
      "shapeExtEMU",
      exts.map((m) => ({
        cx: m[1],
        cy: m[2],
        wIn: (+m[1]! / 914400).toFixed(2),
        hIn: (+m[2]! / 914400).toFixed(2),
      })),
    );
    if (/PingFang/i.test(slide)) {
      console.error("FAIL: PingFang still present");
      process.exit(1);
    }
    if (!/Noto Sans SC/i.test(slide)) {
      console.error("FAIL: expected Noto Sans SC");
      process.exit(1);
    }
    console.log("SMOKE_FONT_REMAP_OK");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
