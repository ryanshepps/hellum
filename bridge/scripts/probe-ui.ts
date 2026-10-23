import { chromium } from "playwright";

const target = process.argv[2] ?? "http://127.0.0.1:7870/assistant/";
const screenshotPath = process.argv[3] ?? "probe.png";
const settleMs = Number(process.argv[4] ?? "6000");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on("request", (request) => {
  const url = new URL(request.url());
  if (url.pathname.startsWith("/assistant/assets") || url.pathname.startsWith("/assistant/fonts")) return;
  process.stdout.write(`REQ ${request.method()} ${url.pathname}${url.search}\n`);
});
page.on("response", (response) => {
  const url = new URL(response.url());
  if (url.pathname.startsWith("/v1")) process.stdout.write(`RES ${response.status()} ${url.pathname}\n`);
});
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") {
    process.stdout.write(`CONSOLE ${message.type()} ${message.text().slice(0, 300)}\n`);
  }
});
page.on("pageerror", (error) => process.stdout.write(`PAGEERROR ${error.message}\n`));
await page.goto(target);
await page.waitForTimeout(settleMs);
process.stdout.write(`URL ${page.url()}\n`);
await page.screenshot({ path: screenshotPath });
await browser.close();
