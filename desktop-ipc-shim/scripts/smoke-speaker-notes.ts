/**
 * Smoke: speaker notes → PPTX notes slides.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

import { renderSlides } from "../src/chrome-renderer.js";

async function main(): Promise<void> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0}
.slide{width:1280px;height:720px;box-sizing:border-box;background:#111;color:#fff;padding:64px;font-family:sans-serif}
.notes{display:none}
h1{margin:0;font-size:48px}
</style></head><body>
<section class="slide"><h1>Slide One</h1><aside class="notes">第一页讲稿：强调开场。</aside></section>
<section class="slide"><h1>Slide Two</h1></section>
<script type="application/json" id="speaker-notes">
["ignored-when-inline-present", "第二页来自 JSON 的讲稿"]
</script>
</body></html>`;

  const out = await mkdtemp(path.join(tmpdir(), "od-notes-"));
  try {
    const result = await renderSlides({ html, deck: true, editable: true, outputDir: out });
    console.log("ok", result.ok, result.error || "");
    if (!result.ok || !result.pptxFile) process.exit(1);
    const unzipped = path.join(out, "x");
    execSync(`mkdir -p "${unzipped}" && unzip -q -o "${result.pptxFile}" -d "${unzipped}"`);
    const notes1 = await readFile(path.join(unzipped, "ppt/notesSlides/notesSlide1.xml"), "utf8");
    const notes2 = await readFile(path.join(unzipped, "ppt/notesSlides/notesSlide2.xml"), "utf8");
    console.log("notes1has", notes1.includes("第一页讲稿"));
    console.log("notes2has", notes2.includes("第二页来自 JSON"));
    if (!notes1.includes("第一页讲稿") || !notes2.includes("第二页来自 JSON")) {
      console.error("FAIL notes content");
      console.error(notes1.slice(0, 400));
      console.error(notes2.slice(0, 400));
      process.exit(1);
    }
    console.log("SMOKE_SPEAKER_NOTES_OK");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
