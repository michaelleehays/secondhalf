"""Render a quick Eevee preview of athlete.glb to assets/models/preview.png.

Panels, left to right: front, three-quarter, head close-up (eyes, eyebrows, eyelashes, skin), and the
same close-up of the phone model. No kit, so the skin texture shows. Run after build_athlete.py:
  python3 assets/blender/render_preview.py
Headless Linux needs Mesa's EGL (Ubuntu: apt-get install libegl1 libegl-mesa0 libgl1-mesa-dri).
"""
import math
import os

import bpy
import numpy as np
from mathutils import Vector

MODELS = os.environ.get(
    "ATHLETE_OUT_DIR", os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models")))
PANEL = (600, 900)  # width, height of each panel in pixels
BACKGROUND = (0.16, 0.17, 0.19)
# (file, camera yaw in degrees with 0 facing the athlete, look-at height in metres, view height in metres)
VIEWS = [("athlete.glb", 0, 0.88, 2.0), ("athlete.glb", 35, 0.88, 2.0),
         ("athlete.glb", 30, 1.62, 0.34), ("athlete_mobile.glb", 30, 1.62, 0.34)]


def setup_scene(model):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = PANEL
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (*BACKGROUND, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
    sc.world = world

    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, model))
    for o in sc.objects:
        if o.name.startswith("kit_"):
            o.hide_render = True

    def light(name, kind, energy, loc, size=1.0):
        data = bpy.data.lights.new(name, kind)
        data.energy = energy
        if kind == "AREA":
            data.size = size
        obj = bpy.data.objects.new(name, data)
        obj.location = loc
        obj.rotation_euler = (Vector((0, 0, 1.2)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        sc.collection.objects.link(obj)

    # front is -y: key light front left, fill front right, rim from behind
    light("key", "AREA", 500, (-1.8, -2.4, 2.6), 2.0)
    light("fill", "AREA", 180, (2.2, -1.8, 1.4), 2.5)
    light("rim", "AREA", 300, (0.6, 2.4, 2.4), 1.5)
    cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam


def render_view(sc, cam, yaw, target_z, view_h, path):
    cam.data.lens = 85
    cam.data.sensor_fit = "VERTICAL"
    dist = view_h * cam.data.lens / cam.data.sensor_height
    a = math.radians(yaw)
    target = Vector((0, 0, target_z))
    cam.location = target + Vector((math.sin(a) * dist, -math.cos(a) * dist, 0))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_start = 0.05
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    tmp = os.path.join(bpy.app.tempdir or "/tmp", "athlete_preview")
    os.makedirs(tmp, exist_ok=True)
    renders = []
    for i, (model, *view) in enumerate(VIEWS):
        sc, cam = setup_scene(model)
        renders.append(os.path.join(tmp, f"view{i}.png"))
        render_view(sc, cam, *view, renders[-1])
    # read_factory_settings in setup_scene clears loaded images, so stitch after all renders
    panels = []
    for path in renders:
        img = bpy.data.images.load(path)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(PANEL[1], PANEL[0], 4)
        panels.append(px)
        bpy.data.images.remove(img)
    sheet = np.concatenate(panels, axis=1)
    out = bpy.data.images.new("preview", sheet.shape[1], sheet.shape[0], alpha=False)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = os.path.join(MODELS, "preview.png")
    out.file_format = "PNG"
    out.save()
    print("wrote", out.filepath_raw)


if __name__ == "__main__":
    main()
