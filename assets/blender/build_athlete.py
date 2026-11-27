# Builds assets/models/athlete.glb with Blender (pip package "bpy") and MPFB 2 installed as a user extension.
# Install: pip install bpy==5.1.2, then clone https://github.com/makehumancommunity/mpfb2 and copy src/mpfb
# to ~/.config/blender/5.1/extensions/user_default/mpfb
# Run from the repo root: python3 -c "exec(open('assets/blender/build_athlete.py').read())"
import bpy,addon_utils,numpy as np,bmesh
addon_utils.enable("bl_ext.user_default.mpfb",default_set=True)
P="bl_ext.user_default.mpfb."
import importlib
HS=importlib.import_module(P+"services.humanservice").HumanService
TS=importlib.import_module(P+"services.targetservice").TargetService
HOP=importlib.import_module(P+"entities.objectproperties").HumanObjectProperties
import os
OUT=os.environ.get('ATHLETE_OUT','assets/models/athlete.glb')  # run from the repo root
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
AVG=dict(gender=1.0,age=0.63,muscle=0.55,weight=0.55,proportions=0.65,height=0.58)
bm=HS.create_human(mask_helpers=False,macro_detail_dict={**AVG,'cupsize':.5,'firmness':.5,'race':{'asian':.33,'caucasian':.34,'african':.33}})
def setm(**kw):
    for k,v in kw.items(): HOP.set_value(k,v,entity_reference=bm)
    TS.reapply_macro_details(bm,remove_zero_weight_targets=False)
def coords():
    dg=bpy.context.evaluated_depsgraph_get();ev=bm.evaluated_get(dg);me=ev.to_mesh()
    a=np.empty(len(me.vertices)*3);me.vertices.foreach_get('co',a);ev.to_mesh_clear();return a.reshape(-1,3)
shapes={}
setm(muscle=.1,weight=1.0); shapes['soft']=coords()
setm(muscle=1.0,weight=.3,proportions=1.0); shapes['athletic']=coords()
setm(muscle=AVG['muscle'],weight=AVG['weight'],proportions=AVG['proportions']); base=coords()
TS.bake_targets(bm)
rig=HS.add_builtin_rig(bm,'mixamo',import_weights=True)
print('rig',rig.name,len(rig.data.bones))
# shape keys
bm.shape_key_add(name='Basis',from_mix=False)
for n,c in shapes.items():
    k=bm.shape_key_add(name=n,from_mix=False);k.data.foreach_set('co',c.ravel())
# split parts by vertex group
def vg_verts(name):
    gi=bm.vertex_groups[name].index
    return {v.index for v in bm.data.vertices if any(g.group==gi and g.weight>.5 for g in v.groups)}
keep={'hair':vg_verts('helper-hair'),'tights':vg_verts('helper-tights'),'eyes':vg_verts('helper-l-eye')|vg_verts('helper-r-eye')}
helpers=vg_verts('HelperGeometry')|vg_verts('JointCubes')
def separate(idx,name):
    bpy.ops.object.select_all(action='DESELECT');bm.select_set(True);bpy.context.view_layer.objects.active=bm
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='DESELECT');bpy.ops.object.mode_set(mode='OBJECT')
    for v in bm.data.vertices: v.select=v.index in idx
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.separate(type='SELECTED');bpy.ops.object.mode_set(mode='OBJECT')
    new=[o for o in bpy.context.selected_objects if o!=bm][0];new.name=name;return new
# delete unwanted helpers first
drop=helpers-keep['tights']-keep['eyes']
bpy.context.view_layer.objects.active=bm;bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='DESELECT');bpy.ops.object.mode_set(mode='OBJECT')
for v in bm.data.vertices: v.select=v.index in drop
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.delete(type='VERT');bpy.ops.object.mode_set(mode='OBJECT')
# recompute index sets after deletion via vertex groups
parts={}
for nm,groups in [('tights',['helper-tights']),('eyes',['helper-l-eye','helper-r-eye'])]:
    s=set()
    for g in groups: s|=vg_verts(g)
    parts[nm]=separate(s,nm)
bm.name='body'
# crop tights to fight shorts: keep verts between mid-thigh and waist, then push outward along normals
H=max(v.co.z for v in bm.data.vertices)-min(v.co.z for v in bm.data.vertices);z0=min(v.co.z for v in bm.data.vertices)
t=parts['tights'];bpy.ops.object.select_all(action='DESELECT');t.select_set(True);bpy.context.view_layer.objects.active=t
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='DESELECT');bpy.ops.object.mode_set(mode='OBJECT')
for v in t.data.vertices: v.select=not (z0+0.355*H < v.co.z < z0+0.58*H)
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.delete(type='VERT');bpy.ops.object.mode_set(mode='OBJECT')
t.data.update()
nrm=np.empty(len(t.data.vertices)*3);t.data.vertices.foreach_get('normal',nrm);nrm=nrm.reshape(-1,3)
for kb in t.data.shape_keys.key_blocks:
    c=np.empty(len(kb.data)*3);kb.data.foreach_get('co',c);c=c.reshape(-1,3)+nrm*0.011;kb.data.foreach_set('co',c.ravel())
# scalp -> buzz cut material slot on body
scalp_gi=bm.vertex_groups['scalp'].index
scalp={v.index for v in bm.data.vertices if any(g.group==scalp_gi and g.weight>.3 for g in v.groups)}

def mat(name,col,rough):
    m=bpy.data.materials.new(name);m.use_nodes=True;b=m.node_tree.nodes['Principled BSDF'];b.inputs['Base Color'].default_value=(*col,1);b.inputs['Roughness'].default_value=rough;return m
for o,m in [(bm,mat('Skin',(.55,.38,.29),.55)),(parts['tights'],mat('Tights',(.03,.03,.035),.6)),(parts['eyes'],mat('Eyes',(.05,.03,.02),.2))]:
    o.data.materials.clear();o.data.materials.append(m)
bm.data.materials.append(mat('Hair',(.04,.03,.025),.8))
for poly in bm.data.polygons:
    if all(i in scalp for i in poly.vertices): poly.material_index=1
# clean vertex groups not bones (keeps file small)
bones={b.name for b in rig.data.bones}
for o in [bm,*parts.values()]:
    for g in list(o.vertex_groups):
        if g.name not in bones: o.vertex_groups.remove(g)
    for p in o.data.polygons: p.use_smooth=True
    print(o.name,len(o.data.vertices),[k.name for k in o.data.shape_keys.key_blocks] if o.data.shape_keys else None)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT,export_format='GLB',use_selection=True,export_morph=True,export_skins=True,export_animations=False,export_apply=False,export_morph_normal=False)
import os;print('size',os.path.getsize(OUT))
