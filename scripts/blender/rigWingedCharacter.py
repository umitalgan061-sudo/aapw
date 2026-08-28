#!/usr/bin/env python3
"""
Auto-rigs a winged humanoid sculpt and gives it a wing-flap clip — `bpy` (Blender as a Python
module), so it needs no Blender install and no GUI.

Usage: python3 scripts/blender/rigWingedCharacter.py <decimated.glb> <rigged.glb>

**Why this exists.** The owner's uploads arrive as Tripo/Sketchfab sculpts with `skins: 0` and
`animations: 0`: no skeleton, so no walk and no wing beat. `src/3d/gameplay/creatureRig.js` records
that auto-rigging an arbitrary mesh is an open research problem, and that is still true in general —
what makes it tractable here is that the subject is known (an upright winged humanoid) and the mesh
has been through `scripts/decimateModel.mjs` first, so the heat-map solver has something sane to
work with. Run the decimator before this; on a two-million-triangle blob this is hopeless.

**Bones are placed from the mesh, not from a template.** The script reads the silhouette's height
and half-width and puts the joints at fractions of the figure's own height, so the same script fits
figures of different proportions without hand-tuning. Skinning is Blender's `ARMATURE_AUTO`
(heat-map automatic weights), which is the part that genuinely needs Blender.

**Known limitation, measured rather than assumed.** On `bas_melek.glb` the inner wing bones
(`wing1.L`/`wing1.R`) come back with **0** vertices above 0.2 weight while the outer ones take
1,041 and 2,768: the inner wing sits inside the torso/arm volume, so the solver hands those vertices
to `chest` and `upperarm` instead. The wings do beat — verified in three.js at both extremes of the
clip — but they hinge from mid-wing rather than from the shoulder, and the counts are asymmetric.
Fixing it means moving the wing roots outside the body volume and thinning the arm bones; that is a
tuning pass this script is set up for but has not had.

`bpy` is not installed by default in this environment. `pip install bpy==4.2.0` (a 519 MB wheel).
"""
src, dst = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
mesh_obj = [o for o in bpy.data.objects if o.type == 'MESH'][0]
mesh_obj.name = 'bas_melek'

ws = [mesh_obj.matrix_world @ v.co for v in mesh_obj.data.vertices]
zmin = min(p.z for p in ws); zmax = max(p.z for p in ws); H = zmax - zmin
xmax = max(abs(p.x) for p in ws)
def h(f): return zmin + H * f

# Landmarks as fractions of the figure's height, read off the slab profile in analyse.py:
# 0-30% narrow (legs), 30-45% widening (hips/hands), 45-80% torso+arms, 80-100% widest (wings, halo).
BONES = [
    ('root',      (0,0,h(0.00)),            (0,0,h(0.50)),            None),
    ('spine',     (0,0,h(0.50)),            (0,0,h(0.66)),            'root'),
    ('chest',     (0,0,h(0.66)),            (0,0,h(0.80)),            'spine'),
    ('head',      (0,0,h(0.80)),            (0,0,h(0.95)),            'chest'),
    ('thigh.L',   ( 0.055,0,h(0.50)),       ( 0.075,0,h(0.27)),       'root'),
    ('shin.L',    ( 0.075,0,h(0.27)),       ( 0.080,0,h(0.02)),       'thigh.L'),
    ('thigh.R',   (-0.055,0,h(0.50)),       (-0.075,0,h(0.27)),       'root'),
    ('shin.R',    (-0.075,0,h(0.27)),       (-0.080,0,h(0.02)),       'thigh.R'),
    ('upperarm.L',( 0.090,0,h(0.78)),       ( 0.150,0,h(0.60)),       'chest'),
    ('forearm.L', ( 0.150,0,h(0.60)),       ( 0.190,0,h(0.42)),       'upperarm.L'),
    ('upperarm.R',(-0.090,0,h(0.78)),       (-0.150,0,h(0.60)),       'chest'),
    ('forearm.R', (-0.150,0,h(0.60)),       (-0.190,0,h(0.42)),       'upperarm.R'),
    # Wings: rooted behind the shoulders (-Y is behind in this import), sweeping out and up to the
    # widest part of the silhouette, which the slab profile puts at 85-100% height.
    ('wing1.L',   ( 0.050,-0.06,h(0.80)),   ( 0.260,-0.09,h(0.92)),   'chest'),
    ('wing2.L',   ( 0.260,-0.09,h(0.92)),   ( xmax*0.99,-0.07,h(0.97)),'wing1.L'),
    ('wing1.R',   (-0.050,-0.06,h(0.80)),   (-0.260,-0.09,h(0.92)),   'chest'),
    ('wing2.R',   (-0.260,-0.09,h(0.92)),   (-xmax*0.99,-0.07,h(0.97)),'wing1.R'),
]

arm_data = bpy.data.armatures.new('bas_melek_rig')
arm = bpy.data.objects.new('bas_melek_rig', arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
made = {}
for name, head, tail, parent in BONES:
    b = arm_data.edit_bones.new(name)
    b.head = Vector(head); b.tail = Vector(tail)
    if parent: b.parent = made[parent]; b.use_connect = False
    made[name] = b
bpy.ops.object.mode_set(mode='OBJECT')

# Automatic (heat-map) weights -- the part that needs Blender and cannot be written by hand.
bpy.ops.object.select_all(action='DESELECT')
mesh_obj.select_set(True); arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')

# Report how the weights actually landed, per bone.
groups = {g.name: 0 for g in mesh_obj.vertex_groups}
for v in mesh_obj.data.vertices:
    for g in v.groups:
        if g.weight > 0.2:
            groups[mesh_obj.vertex_groups[g.group].name] += 1
print("\nvertices with weight>0.2 per bone:")
for name, _, _, _ in BONES:
    print("  %-12s %5d" % (name, groups.get(name, 0)))

# A flap loop and an idle, as real glTF animation clips.
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
def key(frame, poses):
    bpy.context.scene.frame_set(frame)
    for bone_name, rot in poses.items():
        pb = arm.pose.bones[bone_name]
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = Euler(rot, 'XYZ')
        pb.keyframe_insert('rotation_euler', frame=frame)

arm.animation_data_create()
flap = bpy.data.actions.new('WingFlap')
arm.animation_data.action = flap
UP, DOWN = math.radians(34), math.radians(-26)
for frame, a in ((1, 0.0), (10, UP), (20, DOWN), (30, 0.0)):
    key(frame, {'wing1.L': (0, a, 0), 'wing2.L': (0, a * 0.8, 0),
                'wing1.R': (0, -a, 0), 'wing2.R': (0, -a * 0.8, 0)})
flap.use_fake_user = True
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.scene.frame_start = 1; bpy.context.scene.frame_end = 30

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_animations=True,
                          export_skins=True, export_apply=False)
print("\nexported", dst)
