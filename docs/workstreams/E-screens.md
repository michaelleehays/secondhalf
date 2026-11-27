# Workstream E: App screens

**Goal:** the Next.js app with every screen, working on mock data first.

**You own:** `apps/web/**`.

**Read first:** the design doc's Voice and language section and the home screen prototype, https://claude.ai/artifact/GsDsysFU4z3Xca9fsUPqeG.

**Deliver:**
1. Next.js (App Router, TypeScript) app, phone-first, deployable on Vercel.
2. Home: HUD (level, score, credits, clock, health, strength, at-risk and recovery pills) over a full-screen slot for the scene. Until workstream C lands, a placeholder canvas.
3. Tonight's check-in bottom sheet: Done, Minimum, Missed, then a one-tap reason; Close the day.
4. Area sheet, athlete sheet, Vision sheet.
5. Weekly review, rewards (credits, real-world rewards you set, in-game items), season setup (pick up to 2 Focus areas), and onboarding that builds a first Level 101 from the user's goals.
6. A local mock engine adapter that returns `SAMPLE_STATE` and scripted events, swapped for the real engine and backend later.

**Design:** dark, athletic, coach voice. No medieval words. Every copy line in the voice rules from `CLAUDE.md`.
