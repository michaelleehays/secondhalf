import { describe, expect, it } from "vitest";
import {
  DEMO_PLAN, add, buildPlan, mergeStates, reminderList, dailyStats, dayScore, discover, fisher, freshState, launchNext, life, normalize, pauseInfo, project,
  sampleState, scoreSummary, testPair, weeklyStats, welch, wk, type State,
} from "../src/logic";

const plan = (start: string) => buildPlan(start, DEMO_PLAN, { birth: "1985-06-01" });

const TODAY = "2026-11-27"; // a Friday

function withLogs(s: State, id: string, start: string, marks: string) {
  // marks: one char per day from start, "y", "n" or "." (not logged)
  [...marks].forEach((c, i) => {
    if (c === ".") return;
    const k = add(start, i);
    (s.logs[k] ??= {})[id] = c as "y" | "n";
  });
  return s;
}

describe("dates", () => {
  it("finds the Monday of the week", () => {
    expect(wk(TODAY)).toBe("2026-11-23");
    expect(wk("2026-11-23")).toBe("2026-11-23");
    expect(wk("2026-11-29")).toBe("2026-11-23");
  });
  it("adds across month ends", () => {
    expect(add("2026-11-30", 1)).toBe("2026-12-01");
    expect(add("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("plans", () => {
  it("ships empty, with no personal details", () => {
    const s = freshState(TODAY);
    expect(s.habits).toEqual([]);
    expect(s.settings.birth).toBe("");
  });
  it("builds a plan from a spec: focus starts today, the rest waits in order", () => {
    const s = plan(TODAY);
    const st = (id: string) => s.habits.find((h) => h.id === id)!;
    expect(st("lights")).toMatchObject({ status: "building", start: TODAY });
    expect(st("alcohol").status).toBe("building");
    expect(st("nojunk").status).toBe("watching");
    expect(st("nosoda")).toMatchObject({ status: "parked", start: null });
    expect(s.habits.filter((h) => h.status === "queued")[0]!.id).toBe("phone");
  });
});

describe("daily chain and grace days", () => {
  it("keeps the chain through one miss, ends it on two in a row", () => {
    const start = add(TODAY, -9);
    const s = withLogs(plan(start), "lights", start, "yyyynyyyyy");
    const h = s.habits.find((x) => x.id === "lights")!;
    const st = dailyStats(s, h, TODAY);
    expect(st.streak).toBe(9);
    expect(st.graces).toEqual([add(start, 4)]);

    const s2 = withLogs(plan(start), "lights", start, "yyyynnyyyy");
    expect(dailyStats(s2, s2.habits.find((x) => x.id === "lights")!, TODAY).streak).toBe(4);
  });
  it("allows only one grace day per window", () => {
    const start = add(TODAY, -6);
    const s = withLogs(plan(start), "lights", start, "ynyynyy");
    // the second miss falls inside the 7-day grace window, so the chain stops there
    expect(dailyStats(s, s.habits.find((x) => x.id === "lights")!, TODAY).streak).toBe(4);
  });
  it("gives don'ts no grace: a setback resets clean days", () => {
    const start = add(TODAY, -5);
    const s = withLogs(plan(start), "alcohol", start, "yyynyy");
    expect(dailyStats(s, s.habits.find((x) => x.id === "alcohol")!, TODAY).streak).toBe(2);
  });
  it("locks in at 17 of 21 and marks lost ground below 5 of 7", () => {
    const start = add(TODAY, -20);
    const s = withLogs(plan(start), "lights", start, "yyyyyyynnyyyyyyynyyyy");
    const h = s.habits.find((x) => x.id === "lights")!;
    expect(dailyStats(s, h, TODAY)).toMatchObject({ done: 18, days: 21, ready: true, status: "locked" });

    const s2 = withLogs(plan(start), "alcohol", start, "yyyyyyyyyyyynnyynnyny");
    const a = s2.habits.find((x) => x.id === "alcohol")!;
    expect(dailyStats(s2, a, TODAY).status).toBe("lost");
    expect(pauseInfo(s2, TODAY).paused).toBe(true);
  });
  it("does not count today against you before you log it", () => {
    const start = add(TODAY, -3);
    const s = withLogs(plan(start), "lights", start, "yyy.");
    expect(dailyStats(s, s.habits.find((x) => x.id === "lights")!, TODAY)).toMatchObject({ streak: 3, status: "track" });
  });
});

describe("weekly rhythms", () => {
  it("counts weeks on target and does not break on the current week", () => {
    const s = plan(add(wk(TODAY), -21));
    const h = s.habits.find((x) => x.id === "workout")!;
    h.status = "building"; h.start = add(wk(TODAY), -21);
    for (const ws of [-21, -14, -7]) for (const d of [0, 2, 4]) (s.logs[add(wk(TODAY), ws + d)] ??= {}).workout = "y";
    const st = weeklyStats(s, h, TODAY);
    expect(st.streak).toBe(3);
    expect(st.done).toBe(3);
    expect(st.ready).toBe(false); // needs 4 completed weeks to judge 3 of 4
  });
});

describe("queue", () => {
  it("launches the next item only when there is room and the queue is not paused", () => {
    const s = plan(TODAY);
    expect(launchNext(s, TODAY, false).launched).toBeNull(); // 2 of 2 in focus
    s.settings.maxActive = 3;
    const r = launchNext(s, TODAY, false);
    expect(r.launched?.id).toBe("phone");
    expect(r.state.habits.find((h) => h.id === "phone")!.start).toBe(TODAY);
    expect(s.habits.find((h) => h.id === "phone")!.status).toBe("queued"); // input not mutated
  });
  it("estimates later start dates with fewer habits at once", () => {
    const s = plan(TODAY);
    expect(project(s, TODAY, 1).last > project(s, TODAY, 3).last).toBe(true);
  });
});

describe("scoring", () => {
  it("scores in-focus, tracked, baseline and check-in points, and never subtracts", () => {
    const s = plan(TODAY);
    s.logs[TODAY] = { lights: "y", alcohol: "n", nojunk: "y", prayer: "y" };
    s.checkins[TODAY] = { m: { mood: 7 }, notes: {}, locked: true };
    const d = dayScore(s, TODAY);
    expect(d.pts).toBe(10 + 0 + 5 + 2 + 5);
    // possible: lights 10 + alcohol 10 + tracked 5 + check-in 5 = 30; earned core 10 + 5 + 5 = 20
    expect(d.rating).toBeCloseTo(20 / 30);
  });
  it("adds the chain bonus after 7 days running", () => {
    const start = add(TODAY, -6);
    const s = withLogs(plan(start), "lights", start, "yyyyyyy");
    expect(dayScore(s, TODAY).pts).toBe(13);
    expect(dayScore(s, add(TODAY, -1)).pts).toBe(10);
  });
  it("compares this week with last week at the same day", () => {
    const s = sampleState(TODAY);
    const sum = scoreSummary(s, TODAY);
    expect(sum.idx).toBe(4);
    expect(sum.total).toBeGreaterThan(0);
    expect(sum.level).toBe(Math.floor(sum.total / 1000) + 1);
  });
});

describe("statistics", () => {
  it("Welch's t-test matches known values", () => {
    const r = welch([1, 2, 3, 4, 5], [3, 4, 5, 6, 7]);
    expect(r.p).toBeCloseTo(0.0805, 3);
  });
  it("Fisher's exact test matches known values", () => {
    expect(fisher(8, 2, 1, 5)).toBeCloseTo(0.0350, 3);
    expect(fisher(3, 3, 3, 3)).toBeCloseTo(1, 6);
  });
  it("needs 5 days each way before testing", () => {
    const s = plan(TODAY);
    const t = testPair(s, s.habits[0]!, s.metrics[0]!, 0);
    expect(t.ok).toBe(false);
  });
  it("finds the effects built into the example data", () => {
    const s = sampleState(TODAY);
    const { found } = discover(s);
    const keys = found.map((t) => `${t.h.id}>${t.m.id}@${t.lag}`);
    expect(keys).toContain("alcohol>energy@1");
    expect(keys).toContain("prayer>peace@0");
  });
});

describe("life clock", () => {
  it("counts weeks left to 75.8", () => {
    const L = life(plan(TODAY), TODAY);
    expect(L.age).toBe(41);
    expect(L.total).toBe(3955);
    expect(L.left).toBe(3955 - L.lived);
  });
});

describe("saved data", () => {
  it("rejects junk and fills in missing settings", () => {
    expect(normalize(null, TODAY)).toBeNull();
    expect(normalize({ habits: "x" }, TODAY)).toBeNull();
    const s = plan(TODAY) as Partial<State>;
    delete s.pts;
    const n = normalize(JSON.parse(JSON.stringify(s)), TODAY)!;
    expect(n.pts.focus).toBe(10);
  });
});

describe("sync merge", () => {
  it("keeps logs and check-ins from both devices, local wins a clash", () => {
    const a = plan(TODAY), b = plan(TODAY);
    a.logs[TODAY] = { lights: "y" };
    b.logs[TODAY] = { lights: "n", alcohol: "y" };
    b.logs[add(TODAY, -1)] = { lights: "y" };
    a.checkins[TODAY] = { m: { mood: 7 }, notes: {} };
    b.checkins[TODAY] = { m: { energy: 4 }, notes: {}, locked: true };
    const m = mergeStates(a, b);
    expect(m.logs[TODAY]).toEqual({ lights: "y", alcohol: "y" });
    expect(m.logs[add(TODAY, -1)]).toEqual({ lights: "y" });
    expect(m.checkins[TODAY]!.locked).toBe(true);
  });
  it("adds habits that only exist on the other device", () => {
    const a = plan(TODAY), b = plan(TODAY);
    b.habits.push({ ...b.habits[0]!, id: "new1", name: "New" });
    expect(mergeStates(a, b).habits.some((h) => h.id === "new1")).toBe(true);
  });
});

describe("reminders", () => {
  it("derives times from lights out and wake, keeps text generic, skips ones turned off", () => {
    const s = plan(TODAY).settings;
    s.reminders.morning = false;
    const r = reminderList(s);
    expect(r.map((x) => [x.id, x.time])).toEqual([["shutdown", "21:00"], ["checkin", "21:15"], ["weekly", "16:00"]]);
    expect(r.find((x) => x.id === "weekly")!.days).toEqual([0]);
  });
});
