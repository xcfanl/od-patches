/**
 * Local smoke: render a 2-slide deck without IPC.
 * Usage: ./node_modules/.bin/tsx scripts/smoke-render.ts
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { renderSlides } from "../src/chrome-renderer.js";

async function main(): Promise<void> {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0}
  .slide{width:1920px;height:1080px;display:flex;align-items:center;justify-content:center;
    font-family:sans-serif;font-size:72px;background:#111;color:#fff}
  .slide:nth-child(2){background:#024;display:none}
  .slide.active{display:flex}
</style></head><body>
  <section class="slide active">Hello One</section>
  <section class="slide">Hello Two</section>
</body></html>`;

  const out = await mkdtemp(path.join(tmpdir(), "od-shim-smoke-"));
  try {
    const result = await renderSlides({
      html,
      deck: true,
      outputDir: out,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok || !result.slideFiles || result.slideFiles.length !== 2) {
      console.error("FAIL: expected 2 slide files", result);
      process.exit(1);
    }
    for (const f of result.slideFiles) {
      const buf = await readFile(f);
      if (buf[0] !== 0x89 || buf[1] !== 0x50) {
        console.error("FAIL: not a PNG", f, buf.subarray(0, 4));
        process.exit(1);
      }
      console.log("ok", f, buf.length, "bytes");
    }
    console.log("SMOKE_OK");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
