import puppeteer from "puppeteer-core";
import { findBrowserExecutable } from "../src/find-browser.js";
import { pageFns, SLIDE_SELECTOR } from "../src/page-scripts.js";

async function main() {
  const exe = findBrowserExecutable(null);
  console.log("chrome", exe);
  const browser = await puppeteer.launch({
    executablePath: exe!,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setContent(
    '<html><body><section class="slide">A</section><section class="slide">B</section></body></html>',
  );
  const runner = new Function(
    `return (${pageFns.countRealSlides.toString()}).apply(null, ${JSON.stringify([SLIDE_SELECTOR])});`,
  ) as () => number;
  console.log("runner", runner.toString().slice(0, 120));
  const n = await page.evaluate(runner);
  console.log("count", n);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
