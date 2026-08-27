/**
 * Smoke: editable PPTX export (dom-to-pptx).
 * Usage: ./node_modules/.bin/tsx scripts/smoke-editable.ts
 */
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { renderSlides } from "../src/chrome-renderer.js";

async function main(): Promise<void> {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0}
  .slide{width:1280px;height:720px;display:flex;align-items:center;justify-content:center;
    font-family:sans-serif;font-size:48px;background:#111;color:#fff;box-sizing:border-box}
  .slide:nth-child(2){background:#024}
</style></head><body>
  <section class="slide"><h1 style="margin:0">Editable One</h1></section>
  <section class="slide"><h1 style="margin:0">Editable Two</h1></section>
</body></html>`;

  const out = await mkdtemp(path.join(tmpdir(), "od-shim-editable-"));
  try {
    const result = await renderSlides({
      html,
      deck: true,
      editable: true,
      outputDir: out,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok || !result.pptxFile) {
      console.error("FAIL: expected ok + pptxFile", result);
      process.exit(1);
    }
    const buf = await readFile(result.pptxFile);
    const st = await stat(result.pptxFile);
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
      console.error("FAIL: not a ZIP/PPTX", buf.subarray(0, 4));
      process.exit(1);
    }
    if (st.size < 1024) {
      console.error("FAIL: pptx too small", st.size);
      process.exit(1);
    }
    console.log("ok", result.pptxFile, st.size, "bytes");
    console.log("SMOKE_EDITABLE_OK");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
