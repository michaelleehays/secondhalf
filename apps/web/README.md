# Web app (workstream E)

Next.js (App Router, TypeScript) app with every screen. Brief: `docs/workstreams/E-screens.md`.

```bash
npm install            # from the repo root
npm run dev -w @second-half/web     # http://localhost:3000
npm run check          # root: typecheck (packages + app), tests, app build
```

`predev` and `prebuild` copy the athlete models from `assets/models` into `public/assets/models` (git-ignored), where the scene loads them.

| Variable | Default | What it does |
| --- | --- | --- |
| `NEXT_PUBLIC_ASSETS_BASE_URL` | `/assets` | Where the scene loads models from. Set it when the app is hosted under a subpath (e.g. `/second-half/assets`) or the models come from a CDN. Read at build time. |

## How it fits together

| Piece | File | Notes |
| --- | --- | --- |
| Home screen | `src/components/Home.tsx` | Scene slot, HUD, dock, sheets, toasts, demo menu |
| Game adapter | `src/lib/adapter.ts` | `GameAdapter` interface. `createLocalAdapter()` runs the real engine in the browser and saves to localStorage |
| Saved game | `src/lib/storage.ts` | `{ state, date, closedOn }` under `second-half:game:v1`. A missing, blocked or unreadable save starts the sample player |
| Scene | `src/lib/sceneLoader.ts` | Loads `@second-half/scene` on demand; falls back to the flat map if WebGL is missing or the scene fails |
| Flat map | `src/lib/placeholderScene.ts` | Implements `SceneHandle`. Draws a `WorldView`, no game logic |
| Sheets | `src/components/Sheets.tsx` | Area (with "I did it" for ready milestones), athlete, Vision and Resistance |
| Your levels | `src/components/LevelsScreen.tsx`, `GoalEditor.tsx`, `src/lib/plan.ts` | Ladder 101 to 501, level names, goal and habit editing as `PlanEdit`s. Shows "Coming soon" while the engine's `applyPlanEdit` is a stub |
| Config | `src/lib/config.ts` | `ASSETS_BASE_URL` |
| Sheet copy | `src/lib/coach.ts` | Coach lines from state, rules and the last step's events |
| Toasts | `src/lib/messages.ts` | Every `GameEvent` to coach-voice toasts, with day and week summaries |
| Check-in | `src/components/CheckInSheet.tsx`, `src/lib/checkin.ts` | Done / Minimum / Missed + reason, builds a `CheckIn` |
| HUD model | `src/lib/hud.ts` | Life clock, level names, at-risk and recovery pills, active habits |

## Dates

The engine never reads the clock. The app passes the device's local date in (`localIsoDate`). The saved game remembers the date it is on and never moves backwards. The demo menu can skip to tomorrow, or run the Sunday rollover (`closeWeek`) and move to the Monday after.

## Swapping in the backend

Write a `GameAdapter` over the backend client and pass it to `<Home adapter={...} />`. Nothing else changes.
