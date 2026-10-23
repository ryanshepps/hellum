import { chromium } from "playwright";
const [target, pathNeedle] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on("response", async (response) => {
  const url = new URL(response.url());
  if (url.pathname.includes(pathNeedle ?? "")) {
    const body = await response.text().catch(() => "");
    process.stdout.write(`${response.request().method()} ${url.pathname}${url.search} -> ${response.status()} ${body.slice(0, 600)}\n`);
  }
});
await page.goto(target ?? "");
await page.waitForTimeout(8000);
await browser.close();
