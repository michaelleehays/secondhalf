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
| `src/resistance.ts` | Resistance markers (size and glow by strength) and dashed attack lines. |
| `src/walker.ts` | Walks the athlete between level spots at walking pace. Pure, tested. |
| `src/burst.ts` | Gold ring burst for `level_up`. |
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

## Resistance and events

Each `WorldView.resistance` entry gets a marker just outside the 101 ring, centred on its target
area's slice, sized and lit by strength (1..5). When `attackingGoalId` resolves to a cell, a dashed
line marches from the marker to that cell. Tapping a marker reports `{ kind: "resistance", id }`.

| Event | What the scene does |
| --- | --- |
| `at_risk` | Strong red pulse on the cell |
| `risk_cleared` | Calm pale flash on the cell |
| `ground_lost` | The cell darkens and shakes; small camera shake |
| `locked_in` | Athlete celebrates; the cell flashes its area colour |
| `level_up` | Athlete celebrates; gold band rises from the new level's ring; that ring's cells flash gold |
| `level_lost` | Small flinch. The walk back down comes from the next `update` |
| `resistance_changed`, `setback` | The marker flares |
| `recovery_started` | Cool flash. The light stays cooler while `inRecovery` is true |

The athlete walks to the edge of the current level's ring in the Body slice whenever `level`
changes. Per-cell effects find their cell through `CellView.goalId`.

## Performance and quality

`createScene(container, { assetsBaseUrl, quality })` takes an optional `quality`: `"auto"` (default),
`"high"` or `"low"`. It is a scene-package extension; the contract's `CreateScene` doesn't list it yet.

| | high | low |
| --- | --- | --- |
| Pixel ratio | `min(dpr, 2)` on phones, `min(dpr, 1.75)` on desktop | half of high, never below 1 |
| Terrain mesh | 160 (phone) / 230 (desktop) segments | 96 segments |
| Terrain shading | physically based (standard) | Lambert |
| Rim light, summit and event point lights | on | off (ambient raised a little) |
| Contact shadow under the athlete | on | off |
| Multisampling | on, except phones on auto | off |

`auto` starts high and drops to low once if, after 10 warm-up frames, the next 60 average under
30 fps, or the first 15 average under 20 fps (so a slow phone doesn't sit through seconds of slow
frames). The chosen level is on the canvas as `data-quality`. There are no shadow maps at any level.

Rendering stops while the tab is hidden (`visibilitychange`) or the container is off-screen
(`IntersectionObserver`), and resumes without a time jump.

The per-frame loop creates no objects: per-frame numbers live in a `Float64Array`, loops over maps
use arrays, and poses, shots, normals and colours are written into reused objects. Checked with
the DevTools heap sampler (inlining off, 5 s at each quality): what remains under the scene's own
frame function averages under 16 bytes a frame, which is V8 number boxing, not objects; the rest
is inside three.js's renderer.

Textures: colour maps (`map`, `emissiveMap`, sheen and specular colour) are set to sRGB, every other
texture slot to linear, with anisotropic filtering up to 8x. The model's own materials are kept,
so textures in the GLB apply as they are.

### Measured frame rate

`node packages/scene/demo/perf.cjs <demo url>` with the demo running. Mid-range Android proxy:
390x844 touch viewport at devicePixelRatio 3 (so the scene loads `athlete_mobile.glb`), CPU
throttled 4x through the DevTools protocol, 3 s warm-up, then 8 s of `requestAnimationFrame`
intervals with the athlete in view.

| Quality | Chose | Average | Median | p95 |
| --- | --- | --- | --- | --- |
| auto | low | 35.0 fps | 33.3 ms | 33.4 ms |
| high | high | 6.1 fps | 167 ms | 183 ms |
| low | low | 37.2 fps | 33.3 ms | 33.4 ms |

Runs vary by a few fps (an earlier run gave auto 33.6, high 5.5, low 31.7).

Headless Chromium draws WebGL with SwiftShader, a software GPU that CPU throttling does not slow.
A CPU profile of the low run shows the scene's JavaScript at about 5% of samples; the frame is
bound by SwiftShader's pixel work. So these numbers say low quality's pixel cost is about 6x
lower than high's, and that the JavaScript has room under a 4x slower CPU. They are not a
measurement of a phone GPU; a real mid-range Android device should be checked before launch.

## Not yet

HTML labels, and a kit API (the contract has no kit field yet).
Tapping the plain beyond the mountain reports `{ kind: "home" }`.
