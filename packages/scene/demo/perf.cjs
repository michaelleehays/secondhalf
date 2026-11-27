/**
 * Frame-time measurement for the scene demo. Not shipped.
 *
 *   npm run demo -w @second-half/scene        # in one terminal (serves http://localhost:5173)
 *   node packages/scene/demo/perf.cjs [url]   # in another; needs Playwright with Chromium
 *
 * Mid-range Android proxy: 390x844 touch viewport (the scene loads athlete_mobile.glb and the phone
 * terrain), devicePixelRatio 3, CPU throttled 4x through the DevTools protocol. After a 3 s warm-up
 * it records requestAnimationFrame intervals for 8 s with the athlete in view and prints average
 * fps, median and 95th-percentile frame time.
 *
 * Caveat: headless Chromium renders WebGL with SwiftShader (on the CPU, in the GPU process), which
 * CPU throttling does not slow, while the page's own JavaScript is throttled. Treat the numbers as
 * main-thread cost plus a software GPU, not as a real phone GPU.
 */
const { chromium } = require("playwright");

const url = process.argv[2] ?? "http://localhost:5173/";
const runs = [
  { name: "quality auto", query: "" },
  { name: "quality high", query: "?quality=high" },
  { name: "quality low", query: "?quality=low" },
];

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  for (const run of runs) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(url + run.query);
    await page.waitForFunction(() => window.scene, null, { timeout: 60000 });
    await page.evaluate(() => {
      const panel = document.getElementById("panel");
      if (panel) panel.open = false;
    });
    await page.waitForTimeout(3000);
    const r = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const times = [];
          let last = performance.now();
          const end = last + 8000;
          const tick = (now) => {
            times.push(now - last);
            last = now;
            if (now < end) requestAnimationFrame(tick);
            else resolve(times);
          };
          requestAnimationFrame(tick);
        }),
    );
    const quality = await page.evaluate(() => document.querySelector("canvas")?.dataset.quality ?? "n/a");
    const sorted = [...r].sort((a, b) => a - b);
    const avg = r.reduce((a, b) => a + b, 0) / r.length;
    const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(1);
    console.log(
      `${run.name.padEnd(13)} chose=${quality.padEnd(4)} frames=${r.length} avg=${(1000 / avg).toFixed(1)} fps  median=${pct(0.5)} ms  p95=${pct(0.95)} ms`,
    );
    await context.close();
  }
  await browser.close();
})();
