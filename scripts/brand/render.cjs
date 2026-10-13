// Re-renders public/meta_image.png and src/assets/default_thumbnail.jpg from the
// HTML templates in this folder. Needs Playwright with Chromium available, e.g.
//   npx -y -p playwright@1.56.1 -c "node scripts/brand/render.cjs"
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../..");
const JOBS = [
  ["og.html", 1200, 630, "public/meta_image.png"],
  ["thumb.html", 1280, 720, "src/assets/default_thumbnail.jpg"],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [file, width, height, out] of JOBS) {
    await page.setViewportSize({ width, height });
    await page.goto(`file://${path.join(__dirname, file)}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const type = out.endsWith(".jpg") ? "jpeg" : "png";
    await page.screenshot({ path: path.join(ROOT, out), type, quality: type === "jpeg" ? 86 : undefined, clip: { x: 0, y: 0, width, height } });
    console.log(`wrote ${out}`);
  }
  await browser.close();
})();
