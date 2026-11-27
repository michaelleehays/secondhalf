# Web app (workstream E)

Next.js (App Router, TypeScript) app with every screen. Brief: `docs/workstreams/E-screens.md`.

```bash
npm install            # from the repo root
npm run dev -w @second-half/web     # http://localhost:3000
npm run check          # root: typecheck (packages + app), tests, app build
```

## How it fits together

| Piece | File | Notes |
| --- | --- | --- |
| Home screen | `src/components/Home.tsx` | Scene slot, HUD, dock, check-in sheet, toasts |
| Scene slot | `src/components/SceneSlot.tsx` | Takes any `CreateScene`. Pass workstream C's `createScene` here when it lands |
| Placeholder scene | `src/lib/placeholderScene.ts` | Flat ring map that implements `SceneHandle`. Draws a `WorldView`, no game logic |
| Game adapter | `src/lib/adapter.ts` | `GameAdapter` interface. `createMockAdapter()` serves `SAMPLE_STATE` |
| Mock close-day | `src/lib/mockEngine.ts` | Stand-in for `engine.closeDay` until workstream A ships it. Reads every number from `RulesConfig` |
| HUD model | `src/lib/hud.ts` | Life clock, at-risk and recovery pills, active habits |
| Check-in draft | `src/lib/checkin.ts` | Done / Minimum / Missed + reason, builds a `CheckIn` |
| Coach messages | `src/lib/messages.ts` | `GameEvent[]` to toasts, in the voice rules from `CLAUDE.md` |

Swapping in the real pieces later: replace `createMockAdapter()` with an adapter over `createEngine()` and the backend, and pass `createScene` from `@second-half/scene` to `SceneSlot`. Nothing else changes.
