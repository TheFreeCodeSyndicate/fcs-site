/*
 * tools/shoot.mjs — full-page screenshots in light, dark and mobile,
 * written to .shots/ (git-ignored). For eyeballing design changes.
 *   node tools/shoot.mjs http://localhost:8000/
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] || "http://localhost:8000/";
mkdirSync(".shots", { recursive: true });
const browser = await chromium.launch({ channel: "msedge" });
for (const [name, viewport, colorScheme] of [
  ["desk-light", { width: 1440, height: 900 }, "light"],
  ["desk-dark", { width: 1440, height: 900 }, "dark"],
  ["mobile", { width: 390, height: 844 }, "light"],
]) {
  const page = await browser.newPage({ viewport, colorScheme });
  await page.goto(base, { waitUntil: "networkidle" });
  // Scroll through once so reveal-on-scroll content is in its final state.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo({ top: y, behavior: "instant" }); await new Promise((r) => setTimeout(r, 80)); }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `.shots/${name}.png`, fullPage: true });
  await page.screenshot({ path: `.shots/${name}-top.png` });
}
await browser.close();
