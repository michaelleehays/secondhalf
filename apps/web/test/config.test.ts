import { describe, expect, it } from "vitest";
import { assetsBaseUrl } from "../src/lib/config";

describe("assets base URL", () => {
  it("defaults to /assets and trims trailing slashes", () => {
    expect(assetsBaseUrl(undefined)).toBe("/assets");
    expect(assetsBaseUrl("  ")).toBe("/assets");
    expect(assetsBaseUrl("/second-half/assets/")).toBe("/second-half/assets");
    expect(assetsBaseUrl("https://cdn.example.com/sh/assets")).toBe("https://cdn.example.com/sh/assets");
  });
});
