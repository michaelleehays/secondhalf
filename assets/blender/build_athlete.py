"""Build the Second Half athlete with headless Blender (pip "bpy") and MPFB 2.

Outputs (in ATHLETE_OUT_DIR, default assets/models next to this script's folder):
  athlete.glb               full model for desktop
  athlete_mobile.glb        lighter model for phones (same rig, same morphs, same node names)
  athlete.manifest.json     node names, morph names and vertex counts, for the scene

Every mesh node is a separate object so the scene can toggle it:
  body, eyes, eyebrows, eyelashes, teeth, shorts   always on
  kit_shoes, kit_watch, kit_jacket, kit_wraps  kit, toggle with node.visible
All meshes share the Mixamo-named rig and carry the "soft" and "athletic" morph targets.
Material names are stable (the scene keys on them): Skin, Hair, Eyes, Eyebrows, Eyelashes, Teeth,
Tights, Shoe, ShoeSole, Watch, WatchFace, Jacket, Wraps.

Skin, eyes, eyebrows, eyelashes and teeth come from MakeHuman's CC0 asset packs, applied with MPFB's
own services (set_character_skin, add_mhclo_asset). Their textures are embedded in the GLB files.
Fetch the packs first with assets/fetch_makehuman.sh (or point MAKEHUMAN_ASSETS at an unzipped copy).

Setup (once):
  pip install bpy==5.1.2
  assets/fetch_makehuman.sh
  git clone --depth 1 https://github.com/makehumancommunity/mpfb2
  copy mpfb2/src/mpfb to the Blender 5.1 user extensions folder, as .../extensions/user_default/mpfb:
    Linux: ~/.config/blender/5.1/extensions/user_default
    macOS: ~/Library/Application Support/Blender/5.1/extensions/user_default
Run from anywhere:
  python3 assets/blender/build_athlete.py
"""
import importlib
import json
import os

import bpy  # must come first: it puts Blender's own modules on the path
import addon_utils
import bmesh
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc

ASSETS = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT_DIR = os.environ.get("ATHLETE_OUT_DIR", os.path.join(ASSETS, "models"))
MH = os.environ.get("MAKEHUMAN_ASSETS", os.path.join(ASSETS, "vendor", "makehuman"))

# ---------------------------------------------------------------- tunables
# Average 42-year-old build, and the two morph extremes the scene blends between.
AVERAGE = dict(gender=1.0, age=0.63, muscle=0.55, weight=0.55, proportions=0.65, height=0.58)
MORPHS = {
    "soft": dict(muscle=0.1, weight=1.0),
    "athletic": dict(muscle=1.0, weight=0.3, proportions=1.0),
}
RACE = {"asian": 0.33, "caucasian": 0.34, "african": 0.33}

# Fight shorts: band of the tights helper between these fractions of body height.
SHORTS_BAND = (0.355, 0.58)
# Distance (metres) each kit shell sits off the surface it was cut from.
OFFSET = dict(shorts=0.011, shoes=0.008, watch=0.004, jacket=0.016, wraps=0.004)
# Smoothing passes before the offset: garments hide skin detail such as toes and abs.
SMOOTH = dict(shorts=0, shoes=0, watch=2, jacket=6, wraps=0)
SHOE_TOP = 0.045           # metres above the ankle joint
SOLE_HEIGHT = 0.018        # faces below this height above the floor get the sole material
SLEEVE_END = 0.80          # along the forearm, 0 elbow .. 1 wrist
WATCH_BAND = (0.86, 0.93)  # left wrist
WRAPS_START = 0.90         # both hands, from here on the forearm ...
WRAPS_END = 0.90           # ... to here along the hand bone (1 = base of the fingers)
JACKET_HEM = 0.565         # fraction of body height, overlapping the top of the shorts
WATCH_FACE = dict(radius=0.019, depth=0.008, segments=20)

# Phone model: fraction of faces kept per node (eyes and watch are already small).
MOBILE_RATIO = dict(body=0.3, shorts=0.5, kit_shoes=0.35, kit_jacket=0.3, kit_wraps=0.4, teeth=0.25)

# MakeHuman CC0 assets, relative to MH. Skin is from Skins 02 (natural male, middle-aged), with its
# diffuse and normal maps. The specular map is not used: glTF has no slot MPFB fills from it.
SKIN = "skins/mindfront_skin_male_african_middleage/mindfront_skin_male_african_middleage.mhmat"
# Face parts: node name -> (MPFB asset type, desktop .mhclo, phone .mhclo, material name).
# Desktop eyebrows and eyelashes are Mindfront's mesh hairs (Eyebrows 01 / Eyelashes 01 packs).
# They are about 10k vertices each, so the phone model uses the textured cards from the system pack.
FACE = {
    "eyes": ("Eyes", "eyes/low-poly/low-poly.mhclo", None, "Eyes"),
    "eyebrows": ("Eyebrows", "eyebrows/mindfront_eyebrows_01/mindfront_eyebrows_01.mhclo",
                 "eyebrows/eyebrow001/eyebrow001.mhclo", "Eyebrows"),
    "eyelashes": ("Eyelashes", "eyelashes/mindfront_eyelashes_01/mindfront_eyelashes_01.mhclo",
                  "eyelashes/eyelashes01/eyelashes01.mhclo", "Eyelashes"),
    "teeth": ("Teeth", "teeth/teeth_base/teeth_base.mhclo", None, "Teeth"),
}
# Eye colour: any .mhmat in eyes/materials (brown, brownlight, green, grey, blue, ...).
EYE_MATERIAL = "eyes/materials/brownlight.mhmat"
# Textures embedded in the GLB, longest side in pixels: (desktop, phone).
TEXTURE_MAX = dict(Skin=(2048, 1024), Eyes=(512, 256), Teeth=(512, 256), Eyebrows=(256, 256), Eyelashes=(256, 256))
JPEG_QUALITY = 88          # textures go into the GLB as JPEG, except those whose alpha is used (PNG)
# Mindfront mesh eyebrows and lashes ship without a texture; they get these flat colours (linear RGB, roughness).
HAIR_MESH_COLORS = dict(Eyebrows=((0.035, 0.025, 0.02), 0.7), Eyelashes=((0.015, 0.012, 0.01), 0.6))

COLORS = {  # linear RGB, roughness
    "Skin": ((0.55, 0.38, 0.29), 0.55),
    "Hair": ((1.0, 1.0, 1.0), 0.6),  # buzz cut: tints the skin texture, whose scalp already has stubble
    "Eyes": ((0.05, 0.03, 0.02), 0.2),
    "Tights": ((0.03, 0.03, 0.035), 0.6),
    "Shoe": ((0.12, 0.13, 0.15), 0.5),
    "ShoeSole": ((0.85, 0.84, 0.8), 0.7),
    "Watch": ((0.02, 0.02, 0.02), 0.45),
    "WatchFace": ((0.01, 0.012, 0.015), 0.15),
    "Jacket": ((0.06, 0.07, 0.09), 0.65),
    "Wraps": ((0.6, 0.08, 0.05), 0.85),
}
B = "mixamorig:"

# ---------------------------------------------------------------- MPFB
addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
_P = "bl_ext.user_default.mpfb."
HumanService = importlib.import_module(_P + "services.humanservice").HumanService
TargetService = importlib.import_module(_P + "services.targetservice").TargetService
HumanProps = importlib.import_module(_P + "entities.objectproperties").HumanObjectProperties
ClothesService = importlib.import_module(_P + "services.clothesservice").ClothesService
Mhclo = importlib.import_module(_P + "entities.clothes.mhclo").Mhclo
MhMaterial = importlib.import_module(_P + "entities.material.mhmaterial").MhMaterial
GameEngineMaterial = importlib.import_module(
    _P + "entities.nodemodel.v2.materials.nodewrappergameengine").NodeWrapperGameEngine


def mh_path(rel):
    path = os.path.join(MH, rel)
    if not os.path.exists(path):
        raise SystemExit(f"Missing MakeHuman asset {path}. Run assets/fetch_makehuman.sh first.")
    return path


def evaluated_coords(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", a)
    ev.to_mesh_clear()
    return a.reshape(-1, 3)


def build_human():
    """MPFB body with baked average shape, Mixamo rig and soft/athletic shape keys."""
    body = HumanService.create_human(mask_helpers=False, macro_detail_dict={**AVERAGE, "cupsize": 0.5, "firmness": 0.5, "race": RACE})

    def set_macros(values):
        for k, v in values.items():
            HumanProps.set_value(k, v, entity_reference=body)
        TargetService.reapply_macro_details(body, remove_zero_weight_targets=False)

    shapes = {}
    for name, values in MORPHS.items():
        set_macros(values)
        shapes[name] = evaluated_coords(body)
    set_macros({k: AVERAGE[k] for k in {k for v in MORPHS.values() for k in v}})
    TargetService.bake_targets(body)
    rig = HumanService.add_builtin_rig(body, "mixamo", import_weights=True)
    body.shape_key_add(name="Basis", from_mix=False)
    for name, co in shapes.items():
        body.shape_key_add(name=name, from_mix=False).data.foreach_set("co", co.ravel())
    return body, rig


def add_face_part(body, asset_type, rel, name):
    """Load one MakeHuman .mhclo with MPFB, rigged to the Mixamo skeleton and given the body's morphs.

    MPFB fits the asset to the body's current shape. Fitting again with each morph switched on gives
    the asset's own soft and athletic shapes, so it stays in place when the scene blends the build.
    """
    path = mh_path(rel)
    obj = HumanService.add_mhclo_asset(path, body, asset_type=asset_type, subdiv_levels=0,
                                       material_type="GAMEENGINE", import_subrig=False)
    obj.name = obj.data.name = name
    mhclo = Mhclo()
    mhclo.load(path)
    mhclo.clothes = obj
    keys = body.data.shape_keys.key_blocks
    for kb in keys[1:]:
        kb.value = 0.0
    shapes = {}
    for morph in MORPHS:
        keys[morph].value = 1.0
        ClothesService.fit_clothes_to_human(obj, body, mhclo, set_parent=False)
        shapes[morph] = coords(obj)
        keys[morph].value = 0.0
    ClothesService.fit_clothes_to_human(obj, body, mhclo, set_parent=False)
    obj.shape_key_add(name="Basis", from_mix=False)
    for morph, co in shapes.items():
        obj.shape_key_add(name=morph, from_mix=False).data.foreach_set("co", co.ravel())
    return obj


def add_face(body):
    """Eyes, eyebrows, eyelashes and teeth. Returns {node: object} and {node: phone object}."""
    full, phone = {}, {}
    for node, (asset_type, rel, phone_rel, _) in FACE.items():
        full[node] = add_face_part(body, asset_type, rel, node)
        if phone_rel:
            phone[node] = add_face_part(body, asset_type, phone_rel, node + ".phone")
    return full, phone


# ---------------------------------------------------------------- mesh helpers
def group_weights(obj, names):
    """Per-vertex sum of weights in the named vertex groups (missing groups count as 0)."""
    idx = {obj.vertex_groups[n].index for n in names if n in obj.vertex_groups}
    w = np.zeros(len(obj.data.vertices))
    for v in obj.data.vertices:
        w[v.index] = sum(g.weight for g in v.groups if g.group in idx)
    return w


def bone_share(obj, rig, names):
    """Fraction of each vertex's skin weight that belongs to the named bones.

    MPFB's Mixamo weights are not normalised (totals run from about 0.2 to 1.2), so raw
    weights cannot be compared against a fixed threshold.
    """
    total = group_weights(obj, [b.name for b in rig.data.bones])
    return group_weights(obj, names) / np.maximum(total, 1e-9)


def coords(obj):
    a = np.empty(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get("co", a)
    return a.reshape(-1, 3)


def delete_verts(obj, mask):
    """Delete vertices where mask is True. bmesh keeps shape keys, weights and UVs."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.flatnonzero(mask)], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def copy_object(src, name):
    obj = src.copy()
    obj.data = src.data.copy()
    obj.name = obj.data.name = name
    bpy.context.collection.objects.link(obj)
    return obj


def cut_region(src, keep, name):
    """New object holding only the vertices of src where keep is True (with weights and shape keys)."""
    obj = copy_object(src, name)
    delete_verts(obj, ~keep)
    return obj


def offset_shell(obj, distance, floor=None):
    """Push every shape key outward along that key's own normals; optionally clamp to a floor height."""
    keys = obj.data.shape_keys.key_blocks
    for kb in keys:
        co = np.empty(len(kb.data) * 3)
        kb.data.foreach_get("co", co)
        n = np.array(kb.normals_vertex_get()).reshape(-1, 3)
        co = co.reshape(-1, 3) + n * distance
        if floor is not None:
            co[:, 2] = np.maximum(co[:, 2], floor)
        kb.data.foreach_set("co", co.ravel())
    obj.data.vertices.foreach_set("co", np.array([d.co[:] for d in keys[0].data]).ravel())
    obj.data.update()


def smooth_shell(obj, iterations, factor=0.5):
    """Laplacian smoothing applied identically to every shape key, so the morphs stay in step.

    Removes skin detail (toes, abs) that a garment would hide. Open edges stay put.
    """
    if iterations <= 0:
        return
    me = obj.data
    e = np.empty(len(me.edges) * 2, int)
    me.edges.foreach_get("vertices", e)
    e = e.reshape(-1, 2)
    n = len(me.vertices)
    bm = bmesh.new()
    bm.from_mesh(me)
    fixed = np.array([v.is_boundary for v in bm.verts])
    bm.free()
    deg = np.bincount(e.ravel(), minlength=n).astype(float)
    move = np.where(fixed | (deg == 0), 0.0, factor)[:, None]
    keys = me.shape_keys.key_blocks
    for kb in keys:
        co = np.empty(n * 3)
        kb.data.foreach_get("co", co)
        co = co.reshape(-1, 3)
        for _ in range(iterations):
            acc = np.zeros_like(co)
            np.add.at(acc, e[:, 0], co[e[:, 1]])
            np.add.at(acc, e[:, 1], co[e[:, 0]])
            avg = acc / np.maximum(deg, 1)[:, None]
            co = co + move * (avg - co)
        kb.data.foreach_set("co", co.ravel())
    me.vertices.foreach_set("co", np.array([d.co[:] for d in keys[0].data]).ravel())
    me.update()


def shape_deltas(obj):
    keys = obj.data.shape_keys.key_blocks
    base = np.array([d.co[:] for d in keys[0].data])
    return {kb.name: np.array([d.co[:] for d in kb.data]) - base for kb in keys[1:]}


def along_bone(co, rig, bone):
    """Position of each vertex along a bone (0 head .. 1 tail) and its distance from the bone axis."""
    b = rig.data.bones[bone]
    h, t = np.array(b.head_local), np.array(b.tail_local)
    ax = t - h
    L = np.linalg.norm(ax)
    s = (co - h) @ ax / (L * L)
    radial = np.linalg.norm(co - h - np.outer(s, ax), axis=1)
    return s, radial


def separate_helpers(body):
    """Drop MPFB helper geometry except the tights, which become their own object.

    The helper eyes go too: the MakeHuman low-poly eyes replace them.
    """
    def vg(names, thr=0.5):
        return group_weights(body, names) > thr

    helpers = vg(["HelperGeometry", "JointCubes"])
    delete_verts(body, helpers & ~vg(["helper-tights"]))
    tights = vg(["helper-tights"])
    t = cut_region(body, tights, "shorts")
    delete_verts(body, tights)
    return t


def body_extent(body):
    z = coords(body)[:, 2]
    return z.min(), z.max() - z.min()


# ---------------------------------------------------------------- clothes and kit
def cut_plane(obj, point, normal, region=None):
    """Cut obj with a plane and delete everything on the side the normal points to.

    Only faces whose vertices are all inside region (a per-vertex mask) are touched, so one
    cut can trim a sleeve without touching the torso. New vertices get interpolated weights,
    UVs and shape keys, which gives clean edges instead of stair steps along the mesh.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    if region is None:
        region = np.ones(len(bm.verts), bool)
    faces = [f for f in bm.faces if all(region[v.index] for v in f.verts)]
    edges = list({e for f in faces for e in f.edges})
    verts = list({v for f in faces for v in f.verts})
    bmesh.ops.bisect_plane(bm, geom=faces + edges + verts, dist=1e-6, plane_co=Vector(point),
                           plane_no=Vector(normal), clear_outer=True)
    # bisect_plane can leave loose vertices on the cleared side
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def bone_frame(rig, bone):
    b = rig.data.bones[bone]
    return b.head_local.copy(), b.tail_local.copy()


def near_bone(obj, rig, bone, lo, hi, radius):
    """Mask of vertices whose position along the bone is within [lo, hi] and close to its axis."""
    s, r = along_bone(coords(obj), rig, bone)
    return (s > lo) & (s < hi) & (r < radius)


def make_shorts(tights, z0, H):
    lo, hi = (z0 + f * H for f in SHORTS_BAND)
    cut_plane(tights, (0, 0, hi), (0, 0, 1))
    cut_plane(tights, (0, 0, lo), (0, 0, -1))
    smooth_shell(tights, SMOOTH["shorts"])
    offset_shell(tights, OFFSET["shorts"])
    return tights


def make_shoes(body, rig, z0):
    """Each shoe is the convex hull of one foot below the shoe top.

    Hull vertices are original foot vertices, so they keep their skin weights and morphs.
    The hull drops the toes and the arch, which is what a shoe does.
    """
    top = rig.data.bones[B + "LeftFoot"].head_local.z + SHOE_TOP
    shoes = cut_region(body, coords(body)[:, 2] < top + 0.03, "kit_shoes")
    cut_plane(shoes, (0, 0, top), (0, 0, 1))
    bm = bmesh.new()
    bm.from_mesh(shoes.data)
    old_faces = list(bm.faces)
    hull_verts = set()
    for side in (1, -1):
        foot = [v for v in bm.verts if v.co.x * side > 0]
        out = bmesh.ops.convex_hull(bm, input=foot, use_existing_faces=False)
        hull_verts |= {v for g in out["geom"] if isinstance(g, bmesh.types.BMFace) for v in g.verts}
    bmesh.ops.delete(bm, geom=old_faces, context="FACES_ONLY")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v not in hull_verts], context="VERTS")
    # an edge loop just above the floor separates the sole from the upper
    bmesh.ops.bisect_plane(bm, geom=list(bm.faces) + list(bm.edges) + list(bm.verts), dist=1e-6,
                           plane_co=Vector((0, 0, z0 + SOLE_HEIGHT)), plane_no=Vector((0, 0, 1)))
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(shoes.data)
    bm.free()
    shoes.data.update()
    smooth_shell(shoes, SMOOTH["shoes"])
    offset_shell(shoes, OFFSET["shoes"], floor=z0)
    return shoes


def _side_cut(obj, rig, side, bone, at, keep_toward_tail, lo, hi, radius=0.08):
    h, t = bone_frame(rig, B + side + bone)
    axis = (t - h).normalized()
    cut_plane(obj, h.lerp(t, at), axis if not keep_toward_tail else -axis,
              near_bone(obj, rig, B + side + bone, lo, hi, radius))


def make_wraps(body, rig):
    co = coords(body)
    keep = np.zeros(len(co), bool)
    for side in ("Left", "Right"):
        s, r = along_bone(co, rig, B + side + "ForeArm")
        hand = bone_share(body, rig, [n for n in body.vertex_groups.keys() if n.startswith(B + side + "Hand")])
        keep |= ((s > WRAPS_START - 0.08) & (r < 0.08)) | (hand > 0.5)
    wraps = cut_region(body, keep, "kit_wraps")
    for side in ("Left", "Right"):
        _side_cut(wraps, rig, side, "ForeArm", WRAPS_START, True, WRAPS_START - 0.15, 1.1)
        # knuckles: plane across the hand, just short of the base of the fingers
        _side_cut(wraps, rig, side, "Hand", WRAPS_END, False, 0.3, 3.0, radius=0.1)
    smooth_shell(wraps, SMOOTH["wraps"])
    offset_shell(wraps, OFFSET["wraps"])
    return wraps


def make_jacket(body, rig, z0, H):
    co = coords(body)
    torso_bones = [B + n for n in ("Hips", "Spine", "Spine1", "Spine2", "LeftUpLeg", "RightUpLeg")]
    arm_bones = [B + s + n for s in ("Left", "Right") for n in ("Shoulder", "Arm", "ForeArm")]
    torso, arms = bone_share(body, rig, torso_bones), bone_share(body, rig, arm_bones)
    head = bone_share(body, rig, [B + "Neck", B + "Head"])
    hands = bone_share(body, rig, [n for n in body.vertex_groups.keys() if "Hand" in n])
    hem = z0 + JACKET_HEM * H
    keep = (torso + arms + head > 0.5) & (hands < 0.5) & ~((torso > arms) & (co[:, 2] < hem - 0.04))
    keep &= co[:, 2] < bone_frame(rig, B + "Head")[0].z
    jacket = cut_region(body, keep, "kit_jacket")

    torso_j = bone_share(jacket, rig, torso_bones) > bone_share(jacket, rig, arm_bones)
    cut_plane(jacket, (0, 0, hem), (0, 0, -1), torso_j)
    # neckline: just above the base of the neck, dipping toward the front (front is -y)
    nh, nt = bone_frame(rig, B + "Neck")
    neck_region = np.linalg.norm(coords(jacket) - np.array(nh), axis=1) < 0.16
    cut_plane(jacket, nh + (nt - nh) * 0.15, Vector((0, -0.45, 1)).normalized(), neck_region)
    for side in ("Left", "Right"):
        _side_cut(jacket, rig, side, "ForeArm", SLEEVE_END, False, SLEEVE_END - 0.2, 1.3, radius=0.09)
    smooth_shell(jacket, SMOOTH["jacket"])
    offset_shell(jacket, OFFSET["jacket"])
    return jacket


def make_watch(body, rig):
    """Band cut from the left wrist plus a rigid face on the back of the wrist."""
    co = coords(body)
    fore = B + "LeftForeArm"
    s, r = along_bone(co, rig, fore)
    arm = bone_share(body, rig, [fore, B + "LeftHand"])
    band = (arm > 0.5) & (s > WATCH_BAND[0] - 0.06) & (s < WATCH_BAND[1] + 0.06) & (r < 0.07)
    watch = cut_region(body, band, "kit_watch")
    _side_cut(watch, rig, "Left", "ForeArm", WATCH_BAND[0], True, 0.5, 1.2)
    _side_cut(watch, rig, "Left", "ForeArm", WATCH_BAND[1], False, 0.5, 1.2)
    smooth_shell(watch, SMOOTH["watch"])
    offset_shell(watch, OFFSET["watch"])

    # Back of the wrist: for the left hand the palm normal is axis x thumb, so dorsal is its opposite.
    bones = rig.data.bones
    h, t = bones[fore].head_local, bones[fore].tail_local
    axis = (t - h).normalized()
    thumb = bones[B + "LeftHandThumb1"].head_local - bones[B + "LeftHand"].head_local
    thumb = (thumb - axis * thumb.dot(axis)).normalized()
    dorsal = -axis.cross(thumb).normalized()
    centre = h.lerp(t, sum(WATCH_BAND) / 2)

    wco = coords(watch)
    radial = (wco - np.array(centre)) @ np.array(dorsal)
    anchor = int(np.argmax(radial))  # band vertex furthest toward the back of the wrist
    depth = WATCH_FACE["depth"]
    pos = centre + dorsal * (radial[anchor] + depth / 2 - 0.002)

    deltas = shape_deltas(watch)
    weights = {watch.vertex_groups[g.group].name: g.weight for g in watch.data.vertices[anchor].groups}
    rot = dorsal.to_track_quat("Z", "Y").to_matrix().to_4x4()

    me = watch.data
    set_materials(watch, "Watch", "WatchFace")
    for p in me.polygons:
        p.material_index = 0
    bm = bmesh.new()
    bm.from_mesh(me)
    deform = bm.verts.layers.deform.verify()
    shape = {k: bm.verts.layers.shape[k] for k in bm.verts.layers.shape.keys()}
    basis = me.shape_keys.key_blocks[0].name
    made = bmesh.ops.create_cone(bm, cap_ends=True, segments=WATCH_FACE["segments"], radius1=WATCH_FACE["radius"],
                                 radius2=WATCH_FACE["radius"], depth=depth, matrix=Matrix.Translation(pos) @ rot)
    gidx = {n: watch.vertex_groups[n].index for n in weights}
    for v in made["verts"]:
        for n, w in weights.items():
            v[deform][gidx[n]] = w
        for name, layer in shape.items():
            v[layer] = v.co + Vector(deltas[name][anchor]) if name != basis else v.co
        for f in v.link_faces:
            f.material_index = 1
            f.smooth = False
    bm.to_mesh(me)
    bm.free()
    me.update()
    return watch


# ---------------------------------------------------------------- materials and cleanup
_mats = {}


def material(name):
    if name not in _mats:
        col, rough = COLORS[name]
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (*col, 1)
        bsdf.inputs["Roughness"].default_value = rough
        _mats[name] = m
    return _mats[name]


def mpfb_material(obj, name, mhmat=None):
    """Take over the material MPFB built for obj (Principled BSDF fed by image nodes) under a stable name.

    With mhmat, rebuild it first from that .mhmat with MPFB's game engine node wrapper (eye colour).
    Opaque parts drop MPFB's alpha link; the hair cards keep it and blend.
    name may carry a suffix (Eyebrows.phone) while two versions of a part exist; settings use the base name.
    """
    base = name.split(".")[0]
    mat = obj.data.materials[0]
    if mhmat:
        mat.node_tree.nodes.clear()
        m = MhMaterial()
        m.populate_from_mhmat(mh_path(mhmat))
        GameEngineMaterial.create_instance(mat.node_tree, mhmat=m)
    old = bpy.data.materials.get(name)
    if old is not None and old is not mat:
        old.name = name + ".old"
    mat.name = name
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    alpha = nodes.get("AlphaMapTexture")
    has_texture = nodes.get("DiffuseTexture") is not None and nodes["DiffuseTexture"].image is not None
    blended = base in ("Eyebrows", "Eyelashes") and has_texture
    if alpha is not None and not blended:
        nodes.remove(alpha)
    if base in HAIR_MESH_COLORS and not has_texture:
        col, rough = HAIR_MESH_COLORS[base]
        bsdf.inputs["Base Color"].default_value = (*col, 1)
        bsdf.inputs["Roughness"].default_value = rough
    else:
        bsdf.inputs["Roughness"].default_value = COLORS.get(base, ((0, 0, 0), 0.5))[1]
    bsdf.inputs["Specular IOR Level"].default_value = 0.3
    mat.surface_render_method = "BLENDED" if blended else "DITHERED"
    mat.use_backface_culling = base not in ("Eyebrows", "Eyelashes")
    return mat


def hair_material(skin):
    """Buzz cut: the skin material (same images, so no extra texture bytes), darkened by a colour factor.

    The glTF exporter writes the multiply as baseColorFactor.
    """
    mat = skin.copy()
    mat.name = "Hair"
    col, rough = COLORS["Hair"]
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    tex = nodes["DiffuseTexture"]
    mix = nodes.new("ShaderNodeMix")
    mix.data_type, mix.blend_type = "RGBA", "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs["B"].default_value = (*col, 1)
    links.new(tex.outputs["Color"], mix.inputs["A"])
    links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    _mats["Hair"] = mat
    return mat


def texture_images(mat):
    return [n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image is not None]


def fit_textures(materials, which):
    """Cap every texture at TEXTURE_MAX[material][which] pixels: 0 for desktop, 1 for phone."""
    for mat in materials:
        cap = TEXTURE_MAX[mat.name.split(".")[0]][which]
        for img in texture_images(mat):
            w, h = img.size
            if max(w, h) > cap:
                img.scale(max(1, w * cap // max(w, h)), max(1, h * cap // max(w, h)))


def set_materials(obj, *names):
    obj.data.materials.clear()
    for n in names:
        obj.data.materials.append(material(n))


def assign_faces(obj, mask_verts, slot):
    for p in obj.data.polygons:
        if all(mask_verts[i] for i in p.vertices):
            p.material_index = slot


def keep_only_bone_groups(obj, rig):
    bones = {b.name for b in rig.data.bones}
    for g in list(obj.vertex_groups):
        if g.name not in bones:
            obj.vertex_groups.remove(g)


# ---------------------------------------------------------------- phone model
def decimate_with_shape_keys(obj, ratio):
    """Collapse-decimate a mesh that has shape keys.

    Blender cannot apply a modifier to a mesh with shape keys, so: remember each key's offsets,
    clear the keys, decimate (weights and UVs survive), then rebuild every key by sampling the
    original offsets at the closest point on the original surface.
    """
    src_co = coords(obj)
    src_polys = [tuple(p.vertices) for p in obj.data.polygons]
    deltas = shape_deltas(obj)
    tree = BVHTree.FromPolygons([Vector(c) for c in src_co], src_polys)

    obj.shape_key_clear()
    mod = obj.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    # The armature modifier is first in the stack; move decimate above it so it applies to rest shape.
    bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
    bpy.ops.object.modifier_apply(modifier=mod.name)

    new_co = coords(obj)
    sampled = {k: np.zeros_like(new_co) for k in deltas}
    for i, c in enumerate(new_co):
        hit, _, face, _ = tree.find_nearest(Vector(c))
        poly = src_polys[face]
        w = poly_3d_calc([Vector(src_co[j]) for j in poly], hit)
        for k, d in deltas.items():
            sampled[k][i] = sum(wi * d[j] for wi, j in zip(w, poly))
    obj.shape_key_add(name="Basis", from_mix=False)
    for k, d in sampled.items():
        obj.shape_key_add(name=k, from_mix=False).data.foreach_set("co", (new_co + d).ravel())


# ---------------------------------------------------------------- export
def export(path, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
        # New shape keys start at 1.0 in Blender. Export every morph at 0 (the average build) so the
        # glTF default weights agree across meshes; the scene sets them from WorldView.athlete.build.
        if o.type == "MESH" and o.data.shape_keys:
            for kb in o.data.shape_keys.key_blocks[1:]:
                kb.value = 0.0
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_morph=True,
                              export_skins=True, export_animations=False, export_apply=False,
                              export_morph_normal=False, export_image_format="JPEG",
                              export_jpeg_quality=JPEG_QUALITY)
    return os.path.getsize(path)


def texture_stats(materials):
    return {m.name: {img.name: list(img.size) for img in texture_images(m)} for m in materials}


def stats(meshes):
    # Blender vertex counts. glTF counts run higher: vertices split at UV seams and material edges.
    return {o.name: {"blenderVertices": len(o.data.vertices), "triangles": sum(len(p.vertices) - 2 for p in o.data.polygons)}
            for o in meshes}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)

    body, rig = build_human()
    face, face_phone = add_face(body)
    shorts = separate_helpers(body)
    body.name = body.data.name = "body"
    z0, H = body_extent(body)

    # Buzz cut: the scalp is a second material slot on the body.
    scalp = group_weights(body, ["scalp"]) > 0.3
    keep_only_bone_groups(body, rig)

    make_shorts(shorts, z0, H)
    kit = [make_shoes(body, rig, z0), make_watch(body, rig), make_jacket(body, rig, z0, H), make_wraps(body, rig)]

    # Skin: MPFB builds the material from the Skins 02 .mhmat; the buzz cut is a second slot.
    HumanService.set_character_skin(mh_path(SKIN), body, skin_type="GAMEENGINE", material_instances=False)
    textured = [mpfb_material(body, "Skin")]
    body.data.materials.append(hair_material(textured[0]))
    assign_faces(body, scalp, 1)
    for node, obj in face.items():
        textured.append(mpfb_material(obj, FACE[node][3], EYE_MATERIAL if node == "eyes" else None))
    phone_textured = {node: mpfb_material(obj, FACE[node][3] + ".phone") for node, obj in face_phone.items()}
    set_materials(shorts, "Tights")
    shoes, watch, jacket, wraps = kit
    set_materials(shoes, "Shoe", "ShoeSole")
    assign_faces(shoes, coords(shoes)[:, 2] < z0 + SOLE_HEIGHT, 1)
    set_materials(jacket, "Jacket")
    set_materials(wraps, "Wraps")
    # watch materials were added in make_watch

    meshes = [body, *face.values(), shorts, *kit]
    for o in [*meshes, *face_phone.values()]:
        keep_only_bone_groups(o, rig)
        for p in o.data.polygons:
            if o is not watch or p.material_index == 0:
                p.use_smooth = True

    fit_textures(textured, 0)
    full_stats = stats(meshes)
    full_textures = texture_stats(textured)
    full_size = export(os.path.join(OUT_DIR, "athlete.glb"), [rig, *meshes])

    # Phone: swap in the light eyebrows and eyelashes under the same node names, then decimate.
    for node, obj in face_phone.items():
        face[node].name = face[node].data.name = node + ".desktop"
        obj.name = obj.data.name = node
        meshes[meshes.index(face[node])] = obj
        old = face[node].data.materials[0]
        textured.remove(old)
        old.name += ".desktop"
        phone_textured[node].name = FACE[node][3]
        textured.append(phone_textured[node])
    for o in meshes:
        if o.name in MOBILE_RATIO:
            decimate_with_shape_keys(o, MOBILE_RATIO[o.name])
            for p in o.data.polygons:
                p.use_smooth = True
    fit_textures(textured, 1)
    mobile_stats = stats(meshes)
    mobile_textures = texture_stats(textured)
    mobile_size = export(os.path.join(OUT_DIR, "athlete_mobile.glb"), [rig, *meshes])

    manifest = {
        "rig": "mixamo",
        "morphTargets": list(MORPHS),
        "alwaysOn": ["body", *FACE, "shorts"],
        "kit": {"shoes": "kit_shoes", "watch": "kit_watch", "jacket": "kit_jacket", "wraps": "kit_wraps"},
        "files": {
            "athlete.glb": {"bytes": full_size, "meshes": full_stats, "textures": full_textures},
            "athlete_mobile.glb": {"bytes": mobile_size, "meshes": mobile_stats, "textures": mobile_textures},
        },
    }
    with open(os.path.join(OUT_DIR, "athlete.manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
