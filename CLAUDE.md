# Working rules for Second Half

Read this before changing anything.

## Where the truth lives
- Game rules, numbers and voice: the game design document, https://claude.ai/artifact/Td6n2eCU7RBvMtZv7HNhN7 (read it with the Claude Docs tools). If code and the doc disagree, ask; do not guess.
- Shared types and every tunable number: `packages/contracts`. Never hard-code a rule value; read it from `DEFAULT_RULES` (or the config passed in).

## Ownership
- Each workstream edits only its own folders (see README). Your brief is in `docs/workstreams/`.
- `packages/contracts` is owned by the lead session. If you need a contract change, open an issue or say so in your pull request description; do not edit it yourself.
- Build against `SAMPLE_STATE` from `@second-half/contracts/fixtures` until the real piece you depend on exists.

## Engineering
- TypeScript, strict. npm workspaces. Node 22.
- `npm run check` (typecheck + tests) must pass before you open a pull request.
- Engine functions are pure: state in, `{ state, events }` out, no mutation, no I/O, no clock reads (dates come in as arguments).
- The scene contains no game logic. It draws a `WorldView` and animates `GameEvent`s.
- Small pull requests, one concern each, merged often. Branch names: `ws-a/...`, `ws-b/...`, and so on.

## Voice
Coach plus athlete. Use: locked in, at risk, lost ground, Resistance, setback, game plan, grace day, kit, credits, crew. Never medieval or fantasy words. State the number, say what happens next, never shame.
