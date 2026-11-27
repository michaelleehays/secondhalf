# Workstream D: Character art

**Goal:** a believable athlete built only from free tools, delivered as glTF files the scene can load.

**You own:** `assets/**`.

**Start from:** `assets/blender/build_athlete.py`. It runs headless with the `bpy` Python package and MPFB 2 installed as a Blender extension, and exports `assets/models/athlete.glb` (MPFB body, Mixamo-named rig, `soft` and `athletic` shape keys, fight shorts, buzz cut). The character prototype is https://claude.ai/artifact/6wGrXxCb7txuYRpgMWArg7.

**Deliver:**
1. Skin texture, eyebrows and better eyes from MakeHuman's CC0 asset packs (download may need the founder's machine if the asset site is blocked from the cloud).
2. Clothes and kit as separate meshes the scene can toggle: running shoes, training watch, fitted jacket, hand wraps.
3. Our own animation clips on the Mixamo rig (idle, run, tired walk, kneel, hit reaction, victory), so we stop borrowing the soldier sample's clips.
4. A lighter phone version of the model.
5. A license log in `assets/LICENSES.md` for every asset used.

**Rule:** CC0 or clearly commercial-use assets only, and log each one.
