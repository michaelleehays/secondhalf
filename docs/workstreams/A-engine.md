# Workstream A: Game engine

**Goal:** every rule in the design doc as pure, tested TypeScript in `packages/engine`.

**You own:** `packages/engine/**`. Read-only: `packages/contracts`.

**Read first:** the design doc sections Core loop, Structure, Scoring and rewards, Health grace and losing ground, Resistance and adaptive rules. Every number is in `DEFAULT_RULES`.

**Deliver, one pull request each, in this order:**
1. `closeDay`: habit points and credits with the level multiplier; health and strength changes; grace days absorbing misses first; double-miss cost; goal progress; locked-in events.
2. Resistance: reasons raise strength; setback at 5 with damage (halved by an equipped game plan); rule adjustments with start and end dates and coach-voice messages.
3. At risk and lost ground: the system-goal miss pattern, risk meter up and down, lost goals restart from 50%, milestone goals only at risk after a failed quarterly check.
4. Levels: clear with 4 of 5; drop a level below 4; frozen progress above the current level.
5. `closeWeek`: idle-area strength loss and progress decay, dividends (milestone half vested), grace refill at month start, risk escalation.
6. Recovery mode: auto trigger (health below 25 or 2+ at risk), life-event pause, once per season each, 5 of 7 days to finish.
7. Maintenance cap of 6 weekly habits (return an event the UI can act on).

**Done when:** each rule has a test named after the rule, `npm run check` passes, and no function mutates its input.

**Out of scope:** persistence, UI, server-side cross-user adaptation.
