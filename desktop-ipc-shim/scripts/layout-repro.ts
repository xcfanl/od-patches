/**
 * Reproduce shrunk/left-aligned capture. Writes PNGs under /tmp/od-shim-layout-test/
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { renderSlides } from "../src/chrome-renderer.js";

const outRoot = "/tmp/od-shim-layout-test";
await mkdir(outRoot, { recursive: true });

const cases: Array<[string, string]> = [
  [
    "plain1280",
    `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#333}
.slide{width:1280px;height:720px;position:relative;background:#fff;box-sizing:border-box}
.slide h1{margin:0;padding:40px;font:bold 64px sans-serif}
.box{position:absolute;right:40px;bottom:40px;width:200px;height:100px;background:#06c;color:#fff;display:flex;align-items:center;justify-content:center}
</style></head><body>
<section class="slide"><h1>Plain 1280</h1><div class="box">BR</div></section>
<section class="slide" style="background:#eef"><h1>Slide 2</h1><div class="box">BR</div></section>
</body></html>`,
  ],
  [
    "deckStage1920",
    `<!doctype html><html><head><meta charset="utf-8">
<script>
customElements.define('deck-stage', class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode:'open'}).innerHTML =
      '<style>:host{position:fixed;inset:0;display:block;overflow:hidden;background:#0a0a0a}' +
      '.stage{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden}' +
      '.canvas{position:relative;flex:none;width:var(--w,1920px);height:var(--h,1080px);transform-origin:center center}' +
      ':host([noscale]) .canvas{transform:none!important}' +
      '::slotted(*){visibility:hidden!important}' +
      '::slotted([data-od-deck-active]){visibility:visible!important}</style>' +
      '<div class="stage"><div class="canvas"><slot></slot></div></div>';
    this._canvas = this.shadowRoot.querySelector('.canvas');
  }
  connectedCallback() {
    this.style.setProperty('--w', '1920px');
    this.style.setProperty('--h', '1080px');
    window.addEventListener('resize', () => this.fit());
    this.fit();
  }
  fit() {
    if (!this._canvas) return;
    if (this.hasAttribute('noscale')) { this._canvas.style.transform = ''; return; }
    const r = this.getBoundingClientRect();
    const s = Math.min(r.width / 1920, r.height / 1080);
    this._canvas.style.transform = 'scale(' + s + ')';
  }
});
</script>
<style>
.slide{width:1920px;height:1080px;margin:0;box-sizing:border-box;background:#111;color:#fff;position:relative}
.slide h1{margin:0;padding:80px;font:bold 96px sans-serif}
.box{position:absolute;right:80px;bottom:80px;width:320px;height:160px;background:#0af;display:flex;align-items:center;justify-content:center;font:bold 40px sans-serif}
</style></head><body>
<deck-stage>
  <section class="slide" data-od-deck-active><h1>Stage 1920</h1><div class="box">BR</div></section>
  <section class="slide"><h1>Stage 2</h1><div class="box">BR</div></section>
</deck-stage>
</body></html>`,
  ],
  [
    "horizontalCarousel",
    `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%}
body{display:flex;overflow-x:auto;background:#222}
.slide{flex:0 0 100vw;width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;background:#fff;color:#111;font:bold 72px sans-serif}
</style></head><body>
<section class="slide">ONE</section>
<section class="slide" style="background:#eef">TWO</section>
<section class="slide" style="background:#ccf">THREE</section>
</body></html>`,
  ],
  [
    `<!doctype html><html><head><style>
html,body{margin:0;background:#222}
.deck{width:1920px;height:1080px;transform:scale(0.65);transform-origin:top left;background:#111}
.slide{width:1920px;height:1080px;box-sizing:border-box;color:#fff;position:relative}
h1{margin:0;padding:80px;font:bold 96px sans-serif}
.box{position:absolute;right:80px;bottom:80px;width:300px;height:150px;background:#0af;display:flex;align-items:center;justify-content:center;font:40px sans-serif}
</style></head><body><div class="deck">
<section class="slide active"><h1>Scaled deck</h1><div class="box">BR</div></section>
<section class="slide"><h1>Two</h1><div class="box">BR</div></section>
</div></body></html>`,
  ],
];

for (const [name, html] of cases) {
  const dir = path.join(outRoot, name);
  await mkdir(dir, { recursive: true });
  const result = await renderSlides({ html, deck: true, outputDir: dir });
  console.log(
    name,
    JSON.stringify({
      ok: result.ok,
      w: result.width,
      h: result.height,
      files: result.slideFiles,
      err: result.error,
    }),
  );
}
