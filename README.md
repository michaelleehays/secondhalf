# Second Half

A habit app framed as a life game. You are 42, the game ends at 84, and you are at halftime. You score by locking in goals across five areas of life (Body, Mind, Work, People, Money). Levels run from 101 to 501, Resistance learns what beats you, and a realistic 3D athlete gets stronger or more worn down with your play.

## Source of truth

- **Game design document:** https://claude.ai/artifact/Td6n2eCU7RBvMtZv7HNhN7 (rules, scoring, voice, data model, build plan)
- **Home screen prototype:** https://claude.ai/artifact/GsDsysFU4z3Xca9fsUPqeG
- **Character prototype:** https://claude.ai/artifact/6wGrXxCb7txuYRpgMWArg7

Prototypes are throwaway single files. This repository is the real app.

## Layout

| Folder | What it holds | Owner |
| --- | --- | --- |
| `packages/contracts` | Shared types, rule config, sample data | Lead session |
| `packages/engine` | All game rules as pure, tested functions | Workstream A |
| `supabase` | Schema, auth, security rules, scheduled jobs | Workstream B |
| `packages/scene` | three.js world: terrain, athlete, Resistance, effects | Workstream C |
| `assets` | Character pipeline and 3D models | Workstream D |
| `apps/web` | Next.js app: every screen | Workstream E |

Workstream briefs live in `docs/workstreams/`. Working rules for every contributor, human or Claude, are in `CLAUDE.md`.

## Commands

```bash
npm install
npm run check   # typecheck + tests
```
