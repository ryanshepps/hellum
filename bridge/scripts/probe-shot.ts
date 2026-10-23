import { chromium } from "playwright";
const [target, shot, width = "390", height = "844", settle = "8000"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 1 });
await page.goto(target ?? "");
await page.waitForTimeout(Number(settle));
await page.screenshot({ path: shot ?? "probe.png" });
await browser.close();
