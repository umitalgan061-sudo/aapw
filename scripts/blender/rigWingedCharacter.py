#!/usr/bin/env python3
"""
Auto-rigs a winged humanoid sculpt and gives it wing-flap, walk and idle clips — `bpy` (Blender as a
Python module), so it needs no Blender install and no GUI.

Usage: python3 scripts/blender/rigWingedCharacter.py <decimated.glb> <rigged.glb>

**Why this exists.** The owner's uploads arrive as Tripo/Sketchfab sculpts with `skins: 0` and
`animations: 0`: no skeleton, so no walk and no wing beat. `src/3d/gameplay/creatureRig.js` records
that auto-rigging an arbitrary mesh is an open research problem, and that stays true in general —
what makes it tractable here is that the subject is known (an upright winged humanoid) and the mesh
has been through `scripts/decimateModel.mjs` first, so the heat-map solver has something sane to work
with. On the 1.96M-triangle original it is hopeless.

**Bones are placed from the mesh, not from a template**: at fractions of the figure's own measured
height, read off its silhouette profile, so the same script fits different proportions without
hand-tuning. Skinning is Blender's `ARMATURE_AUTO` heat-map solver, which is the part that genuinely
needs Blender.

**Two things the first version got wrong, both found by measuring rather than by looking.** The wings
sit at **positive** y on this import — probed slab by slab, the wide upper vertices (|x| > 0.25) run
from y 0.07 to 0.26 — and the first rig put the wing bones at negative y, on the wrong side of the
body, which is why `wing1.L`/`wing1.R` came back with **zero** vertices above 0.2 weight. Second,
even correctly placed, the solver still hands wing vertices to `chest` and `upperarm`, because a wing
root and a shoulder are centimetres apart. So the wing region is claimed explicitly and weighted
along its own span. Counts before and after:

    wing1.L     0 -> 4,678        wing1.R     0 -> 4,822
    wing2.L 1,041 -> 1,953        wing2.R 2,768 -> 2,141

Symmetric, and the beat now hinges at the shoulder instead of mid-wing — verified in three.js at both
extremes of the clip. `upperarm.L` falls from 5,003 to 89 as a direct consequence: those were wing
vertices the solver had been misattributing all along.

`bpy` is not installed by default here. `pip install bpy==4.2.0` (a 519 MB wheel, cp311).
"""
import bpy, sys, math
from mathutils import Vector, Euler
src, dst = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
me = [o for o in bpy.data.objects if o.type == 'MESH'][0]
me.name = 'bas_melek'
ws = [me.matrix_world @ v.co for v in me.data.vertices]
zmin = min(p.z for p in ws); zmax = max(p.z for p in ws); H = zmax - zmin
xmax = max(abs(p.x) for p in ws)
def h(f): return zmin + H * f

# Measured: the wings live at POSITIVE y (0.07..0.26) -- the first rig put them at -y and the inner
# wing bones came back with zero weights because they were inside the torso on the wrong side.
WING_Y0, WING_Y1 = 0.10, 0.20
BONES = [
    ('root',      (0,0,h(0.00)),              (0,0,h(0.50)),              None),
    ('spine',     (0,0,h(0.50)),              (0,0,h(0.66)),              'root'),
    ('chest',     (0,0,h(0.66)),              (0,0,h(0.80)),              'spine'),
    ('head',      (0,0,h(0.80)),              (0,0,h(0.95)),              'chest'),
    ('thigh.L',   ( 0.055,0,h(0.50)),         ( 0.075,0,h(0.27)),         'root'),
    ('shin.L',    ( 0.075,0,h(0.27)),         ( 0.080,0,h(0.02)),         'thigh.L'),
    ('thigh.R',   (-0.055,0,h(0.50)),         (-0.075,0,h(0.27)),         'root'),
    ('shin.R',    (-0.075,0,h(0.27)),         (-0.080,0,h(0.02)),         'thigh.R'),
    ('upperarm.L',( 0.090,-0.01,h(0.78)),     ( 0.150,-0.01,h(0.60)),     'chest'),
    ('forearm.L', ( 0.150,-0.01,h(0.60)),     ( 0.190,-0.01,h(0.42)),     'upperarm.L'),
    ('upperarm.R',(-0.090,-0.01,h(0.78)),     (-0.150,-0.01,h(0.60)),     'chest'),
    ('forearm.R', (-0.150,-0.01,h(0.60)),     (-0.190,-0.01,h(0.42)),     'upperarm.R'),
    ('wing1.L',   ( 0.055,WING_Y0,h(0.79)),   ( 0.260,WING_Y1,h(0.90)),   'chest'),
    ('wing2.L',   ( 0.260,WING_Y1,h(0.90)),   ( xmax,WING_Y1,h(0.96)),    'wing1.L'),
    ('wing1.R',   (-0.055,WING_Y0,h(0.79)),   (-0.260,WING_Y1,h(0.90)),   'chest'),
    ('wing2.R',   (-0.260,WING_Y1,h(0.90)),   (-xmax,WING_Y1,h(0.96)),    'wing1.R'),
]
ad = bpy.data.armatures.new('bas_melek_rig'); arm = bpy.data.objects.new('bas_melek_rig', ad)
bpy.context.collection.objects.link(arm); bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
made = {}
for name, hd, tl, par in BONES:
    b = ad.edit_bones.new(name); b.head = Vector(hd); b.tail = Vector(tl)
    if par: b.parent = made[par]; b.use_connect = False
    made[name] = b
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT')
me.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')

# The heat-map solver hands wing vertices to `chest`/`upperarm` because the wing roots sit close to
# the shoulder. Rather than hope, the wing region is claimed explicitly and weighted along its own
# span, which is what makes the beat hinge at the shoulder instead of mid-wing.
gi = {g.name: g for g in me.vertex_groups}
WING_MIN_Z, WING_MIN_Y = h(0.55), 0.055
claimed = {'wing1.L': 0, 'wing2.L': 0, 'wing1.R': 0, 'wing2.R': 0}
for v in me.data.vertices:
    p = me.matrix_world @ v.co
    if p.z < WING_MIN_Z or p.y < WING_MIN_Y or abs(p.x) < 0.055: continue
    side = 'L' if p.x > 0 else 'R'
    span = min(1.0, max(0.0, (abs(p.x) - 0.055) / max(1e-6, xmax - 0.055)))
    outer = min(1.0, max(0.0, (span - 0.25) / 0.45))          # 0 at the root, 1 past mid-wing
    w1, w2 = 1.0 - outer, outer
    for other in me.vertex_groups:
        if other.name not in (f'wing1.{side}', f'wing2.{side}'):
            other.remove([v.index])
    gi[f'wing1.{side}'].add([v.index], w1, 'REPLACE')
    gi[f'wing2.{side}'].add([v.index], w2, 'REPLACE')
    claimed[f'wing1.{side}'] += 1 if w1 > 0.2 else 0
    claimed[f'wing2.{side}'] += 1 if w2 > 0.2 else 0
print("wing vertices claimed (weight>0.2):", claimed)

counts = {g.name: 0 for g in me.vertex_groups}
for v in me.data.vertices:
    for g in v.groups:
        if g.weight > 0.2: counts[me.vertex_groups[g.group].name] += 1
print("weights>0.2 per bone:", {k: counts[k] for k, *_ in BONES})

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones: pb.rotation_mode = 'XYZ'
def clip(name, frames):
    act = bpy.data.actions.new(name); arm.animation_data.action = act
    for frame, poses in frames:
        bpy.context.scene.frame_set(frame)
        for bone, rot in poses.items():
            pb = arm.pose.bones[bone]; pb.rotation_euler = Euler(rot, 'XYZ')
            pb.keyframe_insert('rotation_euler', frame=frame)
    act.use_fake_user = True
    return act
arm.animation_data_create()
UP, DN = math.radians(38), math.radians(-30)
wing = lambda a: {'wing1.L': (0, a, 0), 'wing2.L': (0, a * 0.75, 0),
                  'wing1.R': (0, -a, 0), 'wing2.R': (0, -a * 0.75, 0)}
clip('WingFlap', [(1, wing(0)), (10, wing(UP)), (20, wing(DN)), (30, wing(0))])
S = math.radians(24)
clip('Walk', [
    (1,  {**wing(math.radians(6)), 'thigh.L': (S,0,0), 'thigh.R': (-S,0,0), 'upperarm.L': (-S*0.5,0,0), 'upperarm.R': (S*0.5,0,0)}),
    (13, {**wing(math.radians(10)), 'thigh.L': (-S,0,0), 'thigh.R': (S,0,0), 'upperarm.L': (S*0.5,0,0), 'upperarm.R': (-S*0.5,0,0)}),
    (25, {**wing(math.radians(6)), 'thigh.L': (S,0,0), 'thigh.R': (-S,0,0), 'upperarm.L': (-S*0.5,0,0), 'upperarm.R': (S*0.5,0,0)}),
])
B = math.radians(3)
clip('Idle', [(1, {**wing(0), 'chest': (0,0,0)}), (30, {**wing(math.radians(4)), 'chest': (B,0,0)}), (60, {**wing(0), 'chest': (0,0,0)})])
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.scene.frame_start = 1; bpy.context.scene.frame_end = 60
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_animations=True, export_skins=True)
print("exported", dst)
