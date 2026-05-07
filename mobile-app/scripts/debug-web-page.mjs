import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("console", (msg) => console.log("console:", msg.type(), msg.text()));
page.on("pageerror", (err) => console.log("pageerror:", err.message));
await page.goto("http://127.0.0.1:8081", { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForTimeout(6000);
await page.screenshot({ path: "C:\\Users\\Danilo\\Documents\\testes app\\debug-web.png" });
const bodyText = await page.locator("body").innerText();
console.log("BODY_TEXT_START");
console.log(bodyText.slice(0, 2000));
console.log("BODY_TEXT_END");
await browser.close();

