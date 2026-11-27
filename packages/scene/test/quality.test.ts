import { describe, expect, it } from "vitest";
import { AUTO_SAMPLE_FRAMES, AUTO_WARMUP_FRAMES, AutoQuality, qualitySettings } from "../src/quality";

describe("qualitySettings", () => {
  it("halves the pixel ratio, coarsens the terrain and drops extras at low", () => {
    const phone = { dpr: 3, phone: true };
    const high = qualitySettings("high", phone);
    const low = qualitySettings("low", phone);
    expect(high.pixelRatio).toBe(2);
    expect(low.pixelRatio).toBe(1);
    expect(low.terrainSegments).toBeLessThan(high.terrainSegments);
    expect([low.pointLights, low.contactShadow]).toEqual([false, false]);
    expect([high.pointLights, high.contactShadow]).toEqual([true, true]);
  });

  it("never drops below one device pixel per CSS pixel on a 1x screen", () => {
    expect(qualitySettings("low", { dpr: 1, phone: false }).pixelRatio).toBe(1);
  });
});

describe("AutoQuality", () => {
  const run = (ms: number) => {
    const a = new AutoQuality();
    let out = null;
    for (let i = 0; i < AUTO_WARMUP_FRAMES + AUTO_SAMPLE_FRAMES; i++) out = a.frame(ms) ?? out;
    return out;
  };

  it("drops to low when the first frames average under 30 fps", () => {
    expect(run(50)).toBe("low");
    expect(run(16.7)).toBe("high");
  });

  it("ignores warm-up frames and decides only once", () => {
    const a = new AutoQuality();
    for (let i = 0; i < AUTO_WARMUP_FRAMES; i++) a.frame(500);
    let out = null;
    for (let i = 0; i < AUTO_SAMPLE_FRAMES; i++) out = a.frame(16) ?? out;
    expect(out).toBe("high");
    expect(a.frame(500)).toBeNull();
  });

  it("starts over after a pause", () => {
    const a = new AutoQuality();
    for (let i = 0; i < AUTO_WARMUP_FRAMES + AUTO_SAMPLE_FRAMES - 1; i++) a.frame(40); // slow, but above the early-exit line
    a.reset();
    let out = null;
    for (let i = 0; i < AUTO_WARMUP_FRAMES + AUTO_SAMPLE_FRAMES; i++) out = a.frame(16) ?? out;
    expect(out).toBe("high");
  });
});

describe("AutoQuality early exit", () => {
  it("decides low early when clearly slow", async () => {
    const { AUTO_EARLY_FRAMES } = await import("../src/quality");
    const a = new AutoQuality();
    let out = null;
    let n = 0;
    while (!out && n < 1000) {
      out = a.frame(150);
      n++;
    }
    expect(out).toBe("low");
    expect(n).toBe(AUTO_WARMUP_FRAMES + AUTO_EARLY_FRAMES);
  });
});
