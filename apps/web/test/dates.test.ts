import { describe, expect, it } from "vitest";
import { addDays, laterOf, localIsoDate, shortDate, sundayOnOrAfter, weekday } from "../src/lib/dates";

describe("dates", () => {
  it("reads the device's local calendar date", () => {
    expect(localIsoDate(new Date(2026, 10, 27, 23, 59))).toBe("2026-11-27");
    expect(localIsoDate(new Date(2027, 0, 1, 0, 1))).toBe("2027-01-01");
  });
  it("adds days across months and years", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("finds the Sunday that ends the week", () => {
    expect(weekday("2026-11-29")).toBe(0);
    expect(sundayOnOrAfter("2026-11-27")).toBe("2026-11-29");
    expect(sundayOnOrAfter("2026-11-29")).toBe("2026-11-29");
    expect(sundayOnOrAfter("2026-11-30")).toBe("2026-12-06");
  });
  it("compares and formats", () => {
    expect(laterOf("2026-11-27", "2026-11-26")).toBe("2026-11-27");
    expect(shortDate("2026-11-26")).toBe("Thu 26 Nov");
  });
});
