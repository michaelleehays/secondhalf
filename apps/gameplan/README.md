# Game Plan (installable web app)

The simpler habit app: one queue of habits, a few in focus at a time, a nightly check-in, weekly points against your own past weeks, a life clock, and insights that test which habits move how you feel.

It is a static web app (Vite + TypeScript, no framework). On iPhone, open it in Safari, tap Share, then **Add to Home Screen**. It then opens full screen with its own icon and works offline.

```bash
npm install                       # from the repo root
npm run dev -w @second-half/gameplan      # http://localhost:5173
npm run build -w @second-half/gameplan    # static site in apps/gameplan/dist
npx vitest run apps/gameplan              # logic tests
```

| File | What it holds |
| --- | --- |
| `src/logic.ts` | Data model, default plan, habit stats (chains, grace days, locked in, lost ground), queue forecast, scoring, Welch / Fisher tests with Benjamini–Hochberg. Pure functions; today's date is always passed in. |
| `src/app.ts` | Screens (Today, Plan, Insights, Settings), sheets, events, local save, backup export/import. |
| `public/sw.js` | Service worker: network-first pages, cache-first assets and fonts. |
| `public/manifest.webmanifest`, `public/icons/` | Home screen name, colors and icons. |
| `public/vercel.json` | Cache headers for the service worker and hashed assets. |

## Data

Everything is stored on the device (`localStorage`, key `gameplan:v1`). Settings → Backup exports a JSON file through the share sheet and imports it back. Syncing through Supabase is the next step.

## Deploying

The site is fully static. Build, then upload `dist/` (it includes `vercel.json`).
