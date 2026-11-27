# Web app (workstream E)

Next.js (App Router, TypeScript) app with every screen. Brief: `docs/workstreams/E-screens.md`.

```bash
npm install            # from the repo root
npm run dev -w @second-half/web     # http://localhost:3000
npm run check          # root: typecheck (packages + app), tests, app build
```

`predev` and `prebuild` copy the athlete models from `assets/models` into `public/assets/models` (git-ignored), where the scene loads them.

## How it fits together

| Piece | File | Notes |
| --- | --- | --- |
| Home screen | `src/components/Home.tsx` | Scene slot, HUD, dock, sheets, toasts, demo menu |
| Game adapter | `src/lib/adapter.ts` | `GameAdapter` interface. `createLocalAdapter()` runs the real engine in the browser and saves to localStorage |
| Saved game | `src/lib/storage.ts` | `{ state, date, closedOn }` under `second-half:game:v1`. A missing, blocked or unreadable save starts the sample player |
| Scene | `src/lib/sceneLoader.ts` | Loads `@second-half/scene` on demand; falls back to the flat map if WebGL is missing or the scene fails |
| Flat map | `src/lib/placeholderScene.ts` | Implements `SceneHandle`. Draws a `WorldView`, no game logic |
| Sheets | `src/components/Sheets.tsx` | Area, athlete, Vision and Resistance |
| Sheet copy | `src/lib/coach.ts` | Coach lines from state, rules and the last step's events |
| Toasts | `src/lib/messages.ts` | Every `GameEvent` to coach-voice toasts, with day and week summaries |
| Check-in | `src/components/CheckInSheet.tsx`, `src/lib/checkin.ts` | Done / Minimum / Missed + reason, builds a `CheckIn` |
| HUD model | `src/lib/hud.ts` | Life clock, level names, at-risk and recovery pills, active habits |

## Dates

The engine never reads the clock. The app passes the device's local date in (`localIsoDate`). The saved game remembers the date it is on and never moves backwards. The demo menu can skip to tomorrow, or run the Sunday rollover (`closeWeek`) and move to the Monday after.

## Swapping in the backend

Write a `GameAdapter` over the backend client and pass it to `<Home adapter={...} />`. Nothing else changes.
