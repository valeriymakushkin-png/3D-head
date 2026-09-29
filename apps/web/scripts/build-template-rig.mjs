// Generates public/models/template/rig.json by running the in-browser
// auto-rigger (/lab?mode=rig) in headless Chromium against a running dev
// server:  npm run dev  &&  npm run rig:template
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.env.LAB_URL ?? "http://localhost:3000";
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "models", "template", "rig.json");

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on("console", (m) => console.log(`[browser] ${m.text()}`));
await page.goto(`${base}/lab?mode=rig`);
await page.waitForFunction(() => window.__RIG__ || window.__ERR__, null, { timeout: 180_000 });
const err = await page.evaluate(() => window.__ERR__);
if (err) throw new Error(err);
const rig = await page.evaluate(() => window.__RIG__);
writeFileSync(out, JSON.stringify(rig));
console.log(`wrote ${out}`);
await browser.close();
