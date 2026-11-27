# Assets (workstream D)

Character pipeline and models. See `docs/workstreams/D-character.md`.

## Files

| File | What it is |
| --- | --- |
| `fetch_makehuman.sh` | Downloads MakeHuman's CC0 asset packs into `vendor/makehuman/` (gitignored, about 370 MB). |
| `blender/build_athlete.py` | Headless Blender + MPFB 2 build script. Writes the three files below. |
| `blender/render_preview.py` | Eevee render of the built models to `models/preview.png`. |
| `models/athlete.glb` | Full athlete for desktop. |
| `models/athlete_mobile.glb` | Lighter athlete for phones: same rig, morphs, node and material names. |
| `models/athlete.manifest.json` | Node names, morph names, vertex counts and file sizes, written by the build. |
| `models/preview.png` | Eevee preview: front, three-quarter, desktop head, phone head (no kit). |
| `previews/athlete_kit.png` | Screenshot: no kit, all kit, phone model, bent test pose. |

## What is in the model

- **Rig:** Mixamo bone names (`mixamorig:Hips`, ...), so Mixamo-style clips retarget onto it.
- **Morph targets on every mesh:** `soft` and `athletic`. Drive both from `WorldView.athlete.build`
  (`soft = max(0, -build)`, `athletic = max(0, build)`). Kit meshes carry the same morphs, so they
  stay fitted.
- **Mesh nodes:**

| Node | Materials | Notes |
| --- | --- | --- |
| `body` | `Skin`, `Hair` | MakeHuman skin texture (diffuse + normal map). Hair is the buzz-cut slot on the scalp; it uses the same texture. |
| `eyes` | `Eyes` | MakeHuman low-poly eyes, textured. |
| `eyebrows` | `Eyebrows` | Desktop: mesh hairs. Phone: a textured card with alpha (`alphaMode: BLEND`). |
| `eyelashes` | `Eyelashes` | Same as eyebrows. |
| `teeth` | `Teeth` | Follows the `Head` bone (the Mixamo rig has no jaw). |
| `shorts` | `Tights` | Fight shorts. Always on. This node was called `tights` before; the material name is unchanged. |
| `kit_shoes` | `Shoe`, `ShoeSole` | Running shoes. Soles sit on the floor, so no height change is needed. |
| `kit_watch` | `Watch`, `WatchFace` | Training watch, left wrist. |
| `kit_jacket` | `Jacket` | Fitted training jacket. Sleeves stop above the watch. |
| `kit_wraps` | `Wraps` | Hand wraps, both hands. |

All textures are embedded in the GLB (JPEG, or PNG where alpha is used), so the scene needs no extra
files. Morph weights default to 0 (the average build) on every mesh.

Toggle kit by setting the node's `visible`. In three.js a node with two materials loads as a group
holding one mesh per material, so set `visible` on the `kit_*` node itself, not on its children.

Phone vs desktop (from `athlete.manifest.json`, current build):

| | Desktop | Phone |
| --- | --- | --- |
| Body, Blender vertices | 13,380 | 4,015 |
| All meshes, Blender vertices | 42,202 | 7,244 |
| Skin textures | 2048 px | 1024 px |
| File size | 4.6 MB | 1.0 MB |

Vertex counts here and in the manifest (`blenderVertices`) are Blender's. three.js reports more,
because glTF splits vertices at UV seams and material edges.

## Rebuilding

```bash
pip install bpy==5.1.2
assets/fetch_makehuman.sh                 # MakeHuman CC0 packs into assets/vendor/makehuman
git clone --depth 1 https://github.com/makehumancommunity/mpfb2
EXT=~/.config/blender/5.1/extensions/user_default                          # Linux
# EXT="$HOME/Library/Application Support/Blender/5.1/extensions/user_default"  # macOS
mkdir -p "$EXT"
cp -r mpfb2/src/mpfb "$EXT/mpfb"
python3 assets/blender/build_athlete.py   # from any folder, takes under a minute
python3 assets/blender/render_preview.py  # optional; headless Linux needs Mesa EGL (libegl1 libegl-mesa0 libgl1-mesa-dri)
```

Output goes to `assets/models` beside the script, wherever you run it from.

Set `ATHLETE_OUT_DIR` to write somewhere else, and `MAKEHUMAN_ASSETS` to use packs unzipped elsewhere.
Every tunable (build, kit placement, phone reduction, colours, skin, eye colour, face parts, texture
sizes) is a named constant at the top of the script.

## How the kit is made

There are no clothing assets yet, so the kit is cut from the body itself:

1. Pick the body region by bone weight, then trim it with plane cuts for clean edges.
2. Smooth away skin detail the garment would hide (abs on the jacket).
3. Push it out along the surface normals of each morph shape.

The cut-out pieces keep the body's skin weights and morphs, so they follow animation and the
build slider without extra work. Each shoe is the convex hull of the foot, which removes the
toes. These are stand-ins. When the MakeHuman CC0 clothing packs are available, real garments
replace them under the same node names.

The phone model uses collapse decimation. Blender cannot decimate a mesh that has shape keys,
so the script decimates the rest shape and then rebuilds each morph by sampling the original
offsets at the nearest point on the full mesh.

## MakeHuman assets

`fetch_makehuman.sh` downloads four CC0 packs (system assets, Skins 02, Eyebrows 01, Eyelashes 01)
from files.makehumancommunity.org and unzips them into `assets/vendor/makehuman/`. That folder is
gitignored: the system pack alone is about 280 MB. The build applies them with MPFB's own services:
`set_character_skin` for the skin and `add_mhclo_asset` for eyes, eyebrows, eyelashes and teeth, then
refits each face part with the soft and athletic morphs switched on to give it the same morph targets.
Each pack and asset is logged in `LICENSES.md`. Clothing packs can replace the stand-in kit later;
use CC0 packs only.
