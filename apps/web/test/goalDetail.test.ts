import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, type GameState } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { consistentWeeks, goalDetail, goalPhase } from "../src/lib/coach";

const R = DEFAULT_RULES;
const goal = (s: GameState, id: string) => s.goals.find((g) => g.id === id)!;
const fact = (d: ReturnType<typeof goalDetail>, label: string) => d.facts.find((f) => f.label === label)?.value;
const BANNED = /conquer|siege|fallen|enem|attack|counter|shield|armor|gear|gold|party|raid|vanguard|squire|quest|knight/i;

describe("goal phases", () => {
  it("splits the map into past, current and future ground", () => {
    expect(goalPhase(goal(SAMPLE_STATE, "body-101"), SAMPLE_STATE)).toBe("past");
    expect(goalPhase(goal(SAMPLE_STATE, "body-201"), SAMPLE_STATE)).toBe("current");
    expect(goalPhase(goal(SAMPLE_STATE, "money-101"), SAMPLE_STATE)).toBe("current");
    expect(goalPhase(goal(SAMPLE_STATE, "body-301"), SAMPLE_STATE)).toBe("future");
    expect(goalPhase({ ...goal(SAMPLE_STATE, "work-201"), frozen: true }, SAMPLE_STATE)).toBe("future");
  });

  it("counts consistent weeks the way the engine moves progress", () => {
    const g = goal(SAMPLE_STATE, "body-201"); // milestone at 40%, level 2
    const total = R.progress.weeksToLockIn[2];
    expect(consistentWeeks(g, R)).toEqual({ total, done: Math.floor((0.4 / R.progress.milestoneVerifyAt) * total) });
    expect(consistentWeeks({ ...g, kind: "system", progress: 1 }, R)).toEqual({ total, done: total });
  });
});

describe("goal detail", () => {
  it("past ground: when it was locked in, what it pays, and its moments from the journal", () => {
    const s: GameState = {
      ...SAMPLE_STATE,
      goals: SAMPLE_STATE.goals.map((g) => (g.id === "body-101" ? { ...g, lockedInOn: "2026-09-14", verifiedOn: "2026-09-13", verification: "Timed 5K" } : g)),
      journal: [
        { date: "2026-09-13", kind: "verified", area: "body", goalId: "body-101", label: "Ran the 5K in 29:58" },
        { date: "2026-09-14", kind: "locked_in", area: "body", goalId: "body-101", label: "Body 101 locked in" },
        { date: "2026-10-01", kind: "setback", area: "money", label: "Temptation setback: −7 health" },
      ],
    };
    const d = goalDetail(s, goal(s, "body-101"), R, []);
    expect(d.heading).toBe("Locked in");
    expect(fact(d, "Locked in")).toBe("Mon 14 Sept");
    expect(fact(d, "Pays")).toBe(`+${Math.round(R.points.dividendPerLevel * 1 * R.levelMultiplier[2])} points a week`);
    expect(fact(d, "What proved it")).toBe("Timed 5K");
    expect(d.moments.map((m) => m.label)).toEqual(["Body 101 locked in", "Ran the 5K in 29:58"]);
  });

  it("past ground without a journal still shows when it was locked in", () => {
    const s = { ...SAMPLE_STATE, goals: SAMPLE_STATE.goals.map((g) => (g.id === "mind-101" ? { ...g, lockedInOn: "2026-10-05" } : g)) };
    expect(goalDetail(s, goal(s, "mind-101"), R, []).moments).toEqual([{ date: "Mon 5 Oct", label: "Mind 101 locked in" }]);
  });

  it("current ground: progress, consistent weeks, what's left and recent setbacks", () => {
    const d = goalDetail(SAMPLE_STATE, goal(SAMPLE_STATE, "money-101"), R, []);
    expect(d.heading).toBe("At risk");
    expect(fact(d, "Risk")).toBe(`60% · about ${Math.ceil(60 / R.risk.fullCleanDay)} clean days to clear`);
    expect(d.momentsTitle).toBe("Recent setbacks");
    expect(d.moments).toEqual([{ date: "Last 2 weeks", label: "Temptation picked as the reason 6 times" }]);
    const run = goalDetail(SAMPLE_STATE, goal(SAMPLE_STATE, "body-201"), R, []);
    expect(fact(run, "Progress")).toBe("40%");
    expect(fact(run, "What's left")).toMatch(/^About \d+ more consistent weeks, then the real achievement$/);
  });

  it("future ground: what it is, what proves it and what unlocks it", () => {
    const d = goalDetail(SAMPLE_STATE, goal(SAMPLE_STATE, "body-301"), R, []);
    expect(d.heading).toBe("Ahead of you");
    expect(d.title).toBe("Half marathon");
    expect(fact(d, "What proves it")).toBe("Not set yet. Set it in Your levels.");
    expect(fact(d, "Unlocks when")).toBe(`Lock in Body 201 · Reach Level 301: lock in ${R.levels.goalsToClear} of 5 at 201`);
    expect(d.coach).toBe("Body 301 is ahead of you: Half marathon. It opens once you lock in Body 201.");
  });

  it("keeps every line free of castle words", () => {
    for (const g of SAMPLE_STATE.goals) {
      const d = goalDetail(SAMPLE_STATE, g, R, []);
      expect([d.coach, d.heading, ...d.facts.map((f) => f.value)].join(" ")).not.toMatch(BANNED);
    }
  });
});
