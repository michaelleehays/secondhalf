# Assets (workstream D)

Character pipeline and models. See `docs/workstreams/D-character.md`.

## Files

| File | What it is |
| --- | --- |
| `blender/build_athlete.py` | Headless Blender + MPFB 2 build script. Writes the three files below. |
| `models/athlete.glb` | Full athlete for desktop. |
| `models/athlete_mobile.glb` | Lighter athlete for phones: same rig, morphs, node and material names. |
| `models/athlete.manifest.json` | Node names, morph names, vertex counts and file sizes, written by the build. |
| `previews/athlete_kit.png` | Screenshot: no kit, all kit, phone model, bent test pose. |

## What is in the model

- **Rig:** Mixamo bone names (`mixamorig:Hips`, ...), so Mixamo-style clips retarget onto it.
- **Morph targets on every mesh:** `soft` and `athletic`. Drive both from `WorldView.athlete.build`
  (`soft = max(0, -build)`, `athletic = max(0, build)`). Kit meshes carry the same morphs, so they
  stay fitted.
- **Mesh nodes:**

| Node | Materials | Notes |
| --- | --- | --- |
| `body` | `Skin`, `Hair` | Hair is the buzz-cut slot on the scalp. |
| `eyes` | `Eyes` | |
| `shorts` | `Tights` | Fight shorts. Always on. This node was called `tights` before; the material name is unchanged. |
| `kit_shoes` | `Shoe`, `ShoeSole` | Running shoes. Soles sit on the floor, so no height change is needed. |
| `kit_watch` | `Watch`, `WatchFace` | Training watch, left wrist. |
| `kit_jacket` | `Jacket` | Fitted training jacket. Sleeves stop above the watch. |
| `kit_wraps` | `Wraps` | Hand wraps, both hands. |

Toggle kit by setting the node's `visible`. In three.js a node with two materials loads as a group
holding one mesh per material, so set `visible` on the `kit_*` node itself, not on its children.

Phone vs desktop (from `athlete.manifest.json`, current build):

| | Desktop | Phone |
| --- | --- | --- |
| Body, Blender vertices | 13,380 | 4,015 |
| All meshes, Blender vertices | 17,826 | 5,804 |
| File size | 1.7 MB | 0.6 MB |

Vertex counts here and in the manifest (`blenderVertices`) are Blender's. three.js reports more,
because glTF splits vertices at UV seams and material edges.

## Rebuilding

```bash
pip install bpy==5.1.2
git clone --depth 1 https://github.com/makehumancommunity/mpfb2
EXT=~/.config/blender/5.1/extensions/user_default                          # Linux
# EXT="$HOME/Library/Application Support/Blender/5.1/extensions/user_default"  # macOS
mkdir -p "$EXT"
cp -r mpfb2/src/mpfb "$EXT/mpfb"
python3 assets/blender/build_athlete.py   # from any folder, takes a few seconds
```

Output goes to `assets/models` beside the script, wherever you run it from.

Set `ATHLETE_OUT_DIR` to write somewhere else. Every tunable (build, kit placement, phone
reduction, colours) is a named constant at the top of the script.

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

## Waiting on the founder: MakeHuman asset packs

The MakeHuman asset sites (`files.makehumancommunity.org`, `static.makehumancommunity.org`) are
blocked from the cloud workspace. Please download these on your computer and add them to the
repo under `assets/vendor/makehuman/` (or send them over):

Download whole asset folders, not single files. Each `.mhclo` needs the `.obj`, `.mhmat` and
textures that sit beside it, and a skin `.mhmat` needs its textures. Once the build uses them,
commit only the folders it actually uses.

1. **`makehuman_system_assets`** (CC0), from
   https://static.makehumancommunity.org/asset_packs/makehuman_system_assets.html.
   The build will use these folders from it, each complete:
   - `skins/`: a male skin folder (for example the one holding `young_caucasian_male.mhmat`), plus
     any middle-aged or darker-tone male skins the pack includes.
   - `eyes/` (the folder with `low-poly.mhclo`, plus the eye textures)
   - `eyebrows/` (the folder with `eyebrow001.mhclo`)
   - `eyelashes/` (the folder with `eyelashes01.mhclo`)
   - `teeth/` (`teeth_base.mhclo`) and `tongue/` (`tongue01.mhclo`)
2. **Clothing and shoes** (optional, for real garments). From the pack index at
   https://static.makehumancommunity.org/assets/assetpacks.html, download only packs whose page
   says **CC0**. Look for running shoes, a fitted jacket or track top, and shorts. Take each
   garment's whole folder, and include each pack's page or license text so it can be logged.

Do not use packs marked CC-BY, non-commercial or "unknown". They are outside our licence rule.
