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
| `src/createScene.ts` | `createScene`: renderer, lights, input, loop, `SceneHandle`. |

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

Athlete, Resistance markers, event animations (`play`), labels and the demo page come in later pull requests.
Tapping the plain beyond the mountain reports `{ kind: "home" }`.
