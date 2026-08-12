extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g07-relief-probe.json"
const OUTPUT_DIRECTORY := "res://../../artifacts/sw-g07-terrain3d-relief"
const SETTLE_FRAMES := 24

var _terrain: Terrain3D
var _camera: Camera3D
var _probe: Dictionary
var _frame := 0
var _shot := 0
var _shots: Array[Dictionary] = []

func _source_height(u: float, v: float) -> float:
	var rows: Array = _probe["rows"]
	var size := int(_probe["sourceGridSize"])
	var gx := clampf(u, 0.0, 1.0) * float(size - 1)
	var gy := clampf(v, 0.0, 1.0) * float(size - 1)
	var x0 := int(floor(gx)); var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, size - 1); var y1 := mini(y0 + 1, size - 1)
	var tx := gx - float(x0); var ty := gy - float(y0)
	return lerpf(lerpf(float(rows[y0][x0]), float(rows[y0][x1]), tx), lerpf(float(rows[y1][x0]), float(rows[y1][x1]), tx), ty)

func _initialize() -> void:
	if not FileAccess.file_exists(PROBE_PATH):
		printerr("missing G07 relief probe"); quit(1); return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not parsed is Dictionary:
		printerr("invalid G07 relief probe"); quit(1); return
	_probe = parsed
	_terrain = Terrain3D.new()
	_terrain.region_size = 256
	root.add_child(_terrain)
	var image := Image.create_empty(256, 256, false, Image.FORMAT_RF)
	for z in 256:
		for x in 256:
			image.set_pixel(x, z, Color(_source_height(float(x) / 255.0, float(z) / 255.0), 0, 0, 1))
	_terrain.data.import_images([image, null, null], Vector3.ZERO, 0.0, 1.0)

	var sun := DirectionalLight3D.new(); sun.rotation_degrees = Vector3(-48, -35, 0); sun.light_energy = 1.35; root.add_child(sun)
	var env := Environment.new(); env.background_mode = Environment.BG_COLOR; env.background_color = Color(0.055, 0.09, 0.12); env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR; env.ambient_light_color = Color(0.42, 0.52, 0.58); env.ambient_light_energy = 0.9
	var world_env := WorldEnvironment.new(); world_env.environment = env; root.add_child(world_env)
	_camera = Camera3D.new(); _camera.current = true; _camera.far = 2000.0; root.add_child(_camera); _terrain.set_camera(_camera)
	_shots = [
		{"name":"g07-relief-near.png", "position":Vector3(128, 85, 330), "look":Vector3(128, -7, 128)},
		{"name":"g07-relief-topdown.png", "position":Vector3(128, 430, 128), "look":Vector3(128, -7, 128)},
	]

func _process(_delta: float) -> bool:
	if _frame == 0:
		var shot: Dictionary = _shots[_shot]; _camera.position = shot.position; _camera.look_at(shot.look, Vector3.UP)
	_frame += 1
	if _frame < SETTLE_FRAMES: return false
	var image := root.get_texture().get_image()
	var directory := ProjectSettings.globalize_path(OUTPUT_DIRECTORY); DirAccess.make_dir_recursive_absolute(directory)
	var shot: Dictionary = _shots[_shot]
	if image.save_png(directory.path_join(String(shot.name))) != OK:
		printerr("failed to save G07 relief screenshot"); quit(1); return true
	_shot += 1
	if _shot >= _shots.size(): print("SW_G07_TERRAIN3D_RELIEF_VISUAL_OK"); quit(0); return true
	_frame = 0
	return false
