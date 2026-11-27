# Workstream C: 3D world

**Goal:** the terrain mountain and the athlete as a reusable module implementing `CreateScene` from the contracts.

**You own:** `packages/scene/**`. Read-only: `packages/contracts`, `assets/models`.

**Start from:** the home screen prototype, https://claude.ai/artifact/GsDsysFU4z3Xca9fsUPqeG (read it with the Artifact tool; its page source has the terrain shader, Resistance markers, camera views, and the Mixamo retargeting code). Port it, then clean it up.

**Deliver:**
1. `createScene(container, { assetsBaseUrl })` returning a `SceneHandle`: `update(WorldView)`, `play(GameEvent)`, `focus(target)`, `onSelect(cb)`, `dispose()`.
2. Terrain coloured in the shader from `WorldView.cells` (crisp cell edges, risk pulse, frozen and hidden states).
3. Athlete: body sliders from `athlete.build`, slump from `athlete.slump`, knocked-down pose, hit reaction on `setback`, celebration on `locked_in`.
4. Resistance markers sized by strength, attack line to `attackingGoalId`.
5. Performance: 60 fps on a recent iPhone, 30 fps on a mid-range Android. Lighter athlete model on phones.
6. A small demo page that drives the scene from `SAMPLE_STATE` with buttons for each event.

**Use** three.js as an npm dependency (pinned). No game logic in this package.
