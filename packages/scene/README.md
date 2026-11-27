# Scene (workstream C)

The three.js world. See `docs/workstreams/C-scene.md`.

```ts
import { createScene } from "@second-half/scene";
import { toWorldView } from "@second-half/engine";

const scene = await createScene(container, { assetsBaseUrl: "/assets" });
scene.update(toWorldView(state));
scene.onSelect((target) => openSheet(target));
scene.focus({ kind: "area", area: "money" });
// later
scene.dispose();
```

## What is here

| File | Purpose |
| --- | --- |
| `src/layout.ts` | Mountain geometry: height field, ring radii, area sectors, cell index. Pure, tested. |
| `src/cells.ts` | `CellView` to look (tint, progress sweep, risk pulse, dimming). Pure, tested. |
| `src/terrain.ts` | Terrain mesh and shader. Cell colours are computed per fragment for crisp edges. |
| `src/camera.ts` | Camera shots for `home`, `area`, `athlete`, `vision`, and the drag-to-turn rig. |
| `src/poses.ts` | Procedural poses (idle breathing, slump, hit, celebration, down). Pure, tested. |
| `src/athlete.ts` | Wraps the athlete glTF: morphs from `build`, poses on the Mixamo bones, kit toggles. |
| `src/createScene.ts` | `createScene`: renderer, lights, input, loop, events, `SceneHandle`. |
| `demo/` | Demo page, not shipped: `npm run demo -w @second-half/scene`. |

## Assets

`assetsBaseUrl` is where the repo's `assets/` folder is served. The athlete loads from
`${assetsBaseUrl}/models/athlete.glb`, or `athlete_mobile.glb` on touch devices. The promise from
`createScene` resolves once the terrain is ready; the athlete appears when its model has loaded,
and the map keeps working if it fails.

## Athlete

| Input | What the athlete does |
| --- | --- |
| `athlete.build` | `soft = max(0, -build)`, `athletic = max(0, build)` on every mesh, eased |
| `athlete.slump` | Head down, chest caved, shoulders rounded |
| `athlete.knockedDown` | Falls onto their back about the pelvis, lying along the slope and tilted onto it; the athlete shot backs off to frame the whole body |
| `play({ type: "setback" })` | Hit reaction, camera shake, red flash |
| `play({ type: "knocked_down" })` | Hit and fall, before the next `update` arrives |
| `play({ type: "locked_in" })`, `level_up` | Arms-up celebration with two small hops, gold flash |

Kit nodes (`kit_jacket`, `kit_shoes`, `kit_watch`, `kit_wraps`) are hidden. There are no animation
clips yet, so the rig is posed procedurally: rotations in character space, converted to each bone's
local frame. When workstream D ships clips, a mixer can drive the rest pose and these poses layer on top.

## Cell looks

| Status | Look |
| --- | --- |
| `locked_in` | Full area colour |
| `in_progress` | Area colour sweeps across the sector by `progress` |
| `at_risk` | Weaker colour, red pulse that grows with `risk` |
| `lost` | Dark red |
| `open` | Bare ground, slightly lit |
| `hidden` | Bare ground in shadow |
| `frozen` (any status) | Dimmed to 55% |

## Not yet

Resistance markers and attack lines, HTML labels, and a kit API (the contract has no kit field yet).
Tapping the plain beyond the mountain reports `{ kind: "home" }`.
