extends SceneTree
## Renders real preview screenshots of the authored Westeros Terrain3D world
## (GOVERNANCE.md §8.5 visual-verification standard, DECISIONS.md ADR-0266).
##
## Unlike the headless data checks, this one needs an actual rasterizer, so it must run under a
## display server with a GL context — see the workflow/README for the
## `xvfb-run ... --display-driver x11 --rendering-method gl_compatibility --rendering-driver opengl3`
## invocation, the same software-OpenGL technique the existing HTerrain normal-baker proof uses.
##
## Two angles are captured (§8.5 requires at least two): a low "in-world" view near a kingdom seat,
## and a high overview of the whole authored region grid.
##
## Usage: xvfb-run -a -s '-screen 0 1280x720x24' godot --path godot/terrain3d-authoring \
##            --display-driver x11 --rendering-method gl_compatibility --rendering-driver opengl3 \
##            --script res://scripts/render_terrain3d_preview.gd

const SCENE_PATH := "res://scenes/westeros_terrain3d_authoring.tscn"
const MANIFEST_PATH := "res://source_data/westeros_height_r32.json"
const OUTPUT_DIRECTORY := "res://../../artifacts/run317-terrain3d"

## Frames to let Terrain3D settle before each capture. Its clipmap mesh streams regions in relative
## to the active camera over a few frames, so grabbing the very first frame after a camera move can
## catch a half-populated terrain.
const SETTLE_FRAMES := 30

var _terrain: Terrain3D
var _camera: Camera3D
var _manifest: Dictionary = {}
var _frame := 0
var _shot := 0
var _exit_code := 0
var _shots: Array[Dictionary] = []


func _initialize() -> void:
	if not ClassDB.class_exists("Terrain3D"):
		printerr("[render_terrain3d_preview] Terrain3D GDExtension is not loaded.")
		_exit_code = 1
		return
	var packed: PackedScene = load(SCENE_PATH)
	if packed == null:
		printerr("[render_terrain3d_preview] Cannot load %s — run the import script first." % SCENE_PATH)
		_exit_code = 1
		return
	_terrain = packed.instantiate()
	root.add_child(_terrain)

	if FileAccess.file_exists(MANIFEST_PATH):
		var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(MANIFEST_PATH))
		if typeof(parsed) == TYPE_DICTIONARY:
			_manifest = parsed

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-42, -130, 0)
	sun.light_energy = 1.15
	sun.shadow_enabled = true
	root.add_child(sun)

	var environment := Environment.new()
	environment.background_mode = Environment.BG_SKY
	environment.sky = Sky.new()
	environment.sky.sky_material = ProceduralSkyMaterial.new()
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	environment.ambient_light_energy = 0.65
	var world_environment := WorldEnvironment.new()
	world_environment.environment = environment
	root.add_child(world_environment)

	_camera = Camera3D.new()
	_camera.current = true
	_camera.far = 20000.0
	root.add_child(_camera)
	_terrain.set_camera(_camera)

	_shots = _build_shot_list()
	# The first shot is applied on the first processed frame, not here: `Camera3D.look_at()` needs the
	# node to already be inside the tree, and `_initialize()` runs before the tree starts processing.


## Camera setups are derived from the manifest so they stay pointed at the real authored world even
## if its extent or region layout changes later.
func _build_shot_list() -> Array[Dictionary]:
	var target := Vector3.ZERO
	var seats: Array = _manifest.get("seats", [])
	for seat_variant in seats:
		var seat: Dictionary = seat_variant
		if str(seat.id) == "cersei":
			target = Vector3(float(seat.x), float(seat.heightMeters), float(seat.z))
			break

	# `world/terrain.js`'s MACRO_RELIEF_FEATURES mountain — the single largest landform in this world
	# and the only place its relief is obvious at a glance, so the wide shot frames that rather than
	# an empty stretch of the 12km plain.
	var mountain := Vector3(2600.0, 0.0, 2200.0)
	var mountain_peak := Vector3(mountain.x, float(_manifest.get("maxHeightMeters", 166.0)), mountain.z)

	return [
		{
			"name": "terrain3d-ground-view.png",
			"position": target + Vector3(-320.0, 150.0, 320.0),
			"look_at": target,
			"label": "ground view near the Lannister seat",
		},
		{
			"name": "terrain3d-mountain-view.png",
			"position": mountain_peak + Vector3(-2100.0, 620.0, 2100.0),
			"look_at": mountain_peak,
			"label": "wide view of the macro-relief mountain",
		},
	]


func _apply_shot(index: int) -> void:
	var shot: Dictionary = _shots[index]
	_camera.position = shot.position
	_camera.look_at(shot.look_at, Vector3.UP)


func _process(_delta: float) -> bool:
	if _exit_code != 0:
		quit(_exit_code)
		return true

	if _frame == 0:
		_apply_shot(_shot)
	_frame += 1
	if _frame < SETTLE_FRAMES:
		return false

	var image := root.get_texture().get_image()
	if image == null:
		printerr("[render_terrain3d_preview] viewport produced no image")
		quit(1)
		return true

	var directory := ProjectSettings.globalize_path(OUTPUT_DIRECTORY)
	if not DirAccess.dir_exists_absolute(directory):
		DirAccess.make_dir_recursive_absolute(directory)

	var shot: Dictionary = _shots[_shot]
	var out_path: String = directory.path_join(str(shot.name))
	var save_error := image.save_png(out_path)
	if save_error != OK:
		printerr("[render_terrain3d_preview] cannot save %s: %s" % [out_path, error_string(save_error)])
		quit(1)
		return true
	print("[render_terrain3d_preview] wrote %s (%s)" % [out_path, shot.label])

	_shot += 1
	if _shot >= _shots.size():
		print("[render_terrain3d_preview] PASS: %d screenshot(s)" % _shots.size())
		quit(0)
		return true

	_frame = 0
	return false
