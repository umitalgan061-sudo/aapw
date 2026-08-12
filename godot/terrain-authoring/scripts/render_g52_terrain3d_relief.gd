extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g52-relief-probe.json"
const OUTPUT_DIRECTORY := "res://../../artifacts/ne-g52-relief"
const SETTLE_FRAMES := 30

var _terrain: Terrain3D
var _camera: Camera3D
var _probe: Dictionary
var _shots: Array[Dictionary] = []
var _shot := 0
var _frame := 0

func _initialize() -> void:
	if not ClassDB.class_exists("Terrain3D"):
		printerr("[g52-relief-render] Terrain3D is not loaded")
		quit(1)
		return
	if not FileAccess.file_exists(PROBE_PATH):
		printerr("[g52-relief-render] probe missing")
		quit(1)
		return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not parsed is Dictionary:
		printerr("[g52-relief-render] probe invalid")
		quit(1)
		return
	_probe = parsed

	_terrain = Terrain3D.new()
	_terrain.region_size = 256
	root.add_child(_terrain)
	_terrain.data.import_images([_build_height_image(), null, null], Vector3.ZERO, 0.0, 1.0)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48, -125, 0)
	sun.light_energy = 1.25
	sun.shadow_enabled = true
	root.add_child(sun)

	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color(0.17, 0.22, 0.28)
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color(0.62, 0.70, 0.78)
	environment.ambient_light_energy = 0.72
	var world_environment := WorldEnvironment.new()
	world_environment.environment = environment
	root.add_child(world_environment)

	_camera = Camera3D.new()
	_camera.current = true
	_camera.far = 2500.0
	root.add_child(_camera)
	_terrain.set_camera(_camera)

	_shots = [
		{"name":"g52-relief-near.png", "position":Vector3(92, 105, 300), "target":Vector3(150, 24, 155), "top":false},
		{"name":"g52-relief-far.png", "position":Vector3(-85, 235, 390), "target":Vector3(140, 18, 140), "top":false},
		{"name":"g52-relief-topdown.png", "position":Vector3(128, 520, 128), "target":Vector3(128, 0, 128), "top":true},
	]

func _source_height(u: float, v: float) -> float:
	var rows: Array = _probe["rows"]
	var size := int(_probe["sourceGridSize"])
	var gx := clampf(u, 0.0, 1.0) * float(size - 1)
	var gy := clampf(v, 0.0, 1.0) * float(size - 1)
	var x0 := int(floor(gx)); var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, size - 1); var y1 := mini(y0 + 1, size - 1)
	var tx := gx - float(x0); var ty := gy - float(y0)
	return lerpf(lerpf(float(rows[y0][x0]), float(rows[y0][x1]), tx), lerpf(float(rows[y1][x0]), float(rows[y1][x1]), tx), ty)

func _build_height_image() -> Image:
	var image := Image.create_empty(256, 256, false, Image.FORMAT_RF)
	for z in 256:
		for x in 256:
			image.set_pixel(x, z, Color(_source_height(float(x) / 255.0, float(z) / 255.0), 0, 0, 1))
	return image

func _apply_shot() -> void:
	var shot: Dictionary = _shots[_shot]
	_camera.position = shot["position"]
	if bool(shot["top"]):
		_camera.look_at(shot["target"], Vector3.FORWARD)
	else:
		_camera.look_at(shot["target"], Vector3.UP)

func _process(_delta: float) -> bool:
	if _frame == 0:
		_apply_shot()
	_frame += 1
	if _frame < SETTLE_FRAMES:
		return false
	var image := root.get_texture().get_image()
	if image == null:
		printerr("[g52-relief-render] viewport returned no image")
		quit(1)
		return true
	var directory := ProjectSettings.globalize_path(OUTPUT_DIRECTORY)
	DirAccess.make_dir_recursive_absolute(directory)
	var path := directory.path_join(String(_shots[_shot]["name"]))
	if image.save_png(path) != OK:
		printerr("[g52-relief-render] failed to save " + path)
		quit(1)
		return true
	print("[g52-relief-render] wrote " + path)
	_shot += 1
	if _shot >= _shots.size():
		print("NE_G52_RELIEF_VISUAL_PROOF_OK")
		quit(0)
		return true
	_frame = 0
	return false
