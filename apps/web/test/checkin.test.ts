import { describe, expect, it } from "vitest";
import { draftReducer, toCheckIn, unanswered, type Draft } from "../src/lib/checkin";

const ids = ["run", "meditate"];

describe("check-in draft", () => {
  it("counts a miss without a reason as unanswered", () => {
    let d: Draft = {};
    d = draftReducer(d, { type: "result", habitId: "run", result: "full" });
    d = draftReducer(d, { type: "result", habitId: "meditate", result: "missed" });
    expect(unanswered(d, ids)).toEqual(["meditate"]);
    d = draftReducer(d, { type: "reason", habitId: "meditate", reason: "stress" });
    expect(unanswered(d, ids)).toEqual([]);
  });

  it("drops the reason when a miss is changed to done", () => {
    let d: Draft = draftReducer({}, { type: "result", habitId: "run", result: "missed" });
    d = draftReducer(d, { type: "reason", habitId: "run", reason: "fatigue" });
    d = draftReducer(d, { type: "result", habitId: "run", result: "minimum" });
    expect(d.run).toEqual({ result: "minimum" });
  });

  it("ignores a reason for a habit that was not missed", () => {
    const d = draftReducer({ run: { result: "full" } }, { type: "reason", habitId: "run", reason: "fatigue" });
    expect(d.run).toEqual({ result: "full" });
  });

  it("does not mutate the previous draft", () => {
    const before: Draft = { run: { result: "full" } };
    const after = draftReducer(before, { type: "result", habitId: "run", result: "missed" });
    expect(before.run).toEqual({ result: "full" });
    expect(after).not.toBe(before);
  });

  it("builds a CheckIn in habit order, with reasons only on misses", () => {
    const d: Draft = { meditate: { result: "missed", reason: "stress" }, run: { result: "full" } };
    expect(toCheckIn(d, ids, "2026-11-26")).toEqual({
      date: "2026-11-26",
      entries: [
        { habitId: "run", result: "full" },
        { habitId: "meditate", result: "missed", reason: "stress" },
      ],
    });
  });

  it("refuses an incomplete check-in", () => {
    expect(() => toCheckIn({ run: { result: "full" } }, ids, "2026-11-26")).toThrow(/meditate/);
  });
});
