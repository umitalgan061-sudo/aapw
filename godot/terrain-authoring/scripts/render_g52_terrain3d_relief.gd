extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g52-relief-probe.json"
const OUTPUT_DIRECTORY := "res://../../artifacts/ne-g52-relief"
const SETTLE_FRAMES := 18

var _camera: Camera3D
var _probe: Dictionary
var _shots: Array[Dictionary] = []
var _shot := 0
var _frame := 0

func _initialize() -> void:
	call_deferred("_build_scene")

func _fail(message: String) -> void:
	printerr("[g52-relief-render] " + message)
	quit(1)

func _source_height(u: float, v: float) -> float:
	var rows: Array = _probe["rows"]
	var size := int(_probe["sourceGridSize"])
	var gx := clampf(u, 0.0, 1.0) * float(size - 1)
	var gy := clampf(v, 0.0, 1.0) * float(size - 1)
	var x0 := int(floor(gx))
	var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, size - 1)
	var y1 := mini(y0 + 1, size - 1)
	var tx := gx - float(x0)
	var ty := gy - float(y0)
	return lerpf(lerpf(float(rows[y0][x0]), float(rows[y0][x1]), tx), lerpf(float(rows[y1][x0]), float(rows[y1][x1]), tx), ty)

func _build_height_image() -> Image:
	var image := Image.create_empty(256, 256, false, Image.FORMAT_RF)
	for z in 256:
		for x in 256:
			image.set_pixel(x, z, Color(_source_height(float(x) / 255.0, float(z) / 255.0), 0.0, 0.0, 1.0))
	return image

func _build_scene() -> void:
	if not ClassDB.class_exists("Terrain3D"):
		_fail("Terrain3D is not loaded")
		return
	if not FileAccess.file_exists(PROBE_PATH):
		_fail("probe missing")
		return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not parsed is Dictionary:
		_fail("probe invalid")
		return
	_probe = parsed

	# Import the exact high-resolution G52 relief field into pinned Terrain3D, then
	# render its real LOD0 bake instead of leaving the live clipmap renderer active.
	# This preserves Terrain3D provenance while making CI screenshots bounded and
	# deterministic under software OpenGL/Xvfb.
	var terrain := Terrain3D.new()
	terrain.name = "G52Terrain3DReliefRenderSource"
	terrain.region_size = 256
	root.add_child(terrain)
	terrain.data.import_images([_build_height_image(), null, null], Vector3.ZERO, 0.0, 1.0)
	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if baked_mesh == null or baked_mesh.get_surface_count() == 0:
		_fail("Terrain3D LOD0 bake returned no renderable mesh")
		return
	var arrays := baked_mesh.surface_get_arrays(0)
	var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	if vertices.is_empty():
		_fail("Terrain3D LOD0 bake returned no vertices")
		return

	var terrain_mesh := MeshInstance3D.new()
	terrain_mesh.name = "G52Terrain3DBakedRelief"
	terrain_mesh.mesh = baked_mesh
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.31, 0.38, 0.32)
	material.roughness = 0.92
	terrain_mesh.material_override = material
	root.add_child(terrain_mesh)
	terrain.queue_free()

	var sea := MeshInstance3D.new()
	sea.name = "G52SeaReference"
	var sea_mesh := PlaneMesh.new()
	sea_mesh.size = Vector2(256.0, 256.0)
	sea.mesh = sea_mesh
	sea.position = Vector3(128.0, 0.0, 128.0)
	var sea_material := StandardMaterial3D.new()
	sea_material.albedo_color = Color(0.08, 0.20, 0.29, 0.78)
	sea_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sea_material.roughness = 0.36
	sea.material_override = sea_material
	root.add_child(sea)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48, -125, 0)
	sun.light_energy = 1.25
	sun.shadow_enabled = false
	root.add_child(sun)

	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color(0.17, 0.22, 0.28)
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color(0.62, 0.70, 0.78)
	environment.ambient_light_energy = 0.82
	var world_environment := WorldEnvironment.new()
	world_environment.environment = environment
	root.add_child(world_environment)

	_camera = Camera3D.new()
	_camera.current = true
	_camera.far = 2500.0
	root.add_child(_camera)
	_shots = [
		{"name":"g52-relief-near.png", "position":Vector3(92, 105, 300), "target":Vector3(150, 24, 155), "up":Vector3.UP},
		{"name":"g52-relief-far.png", "position":Vector3(-85, 235, 390), "target":Vector3(140, 18, 140), "up":Vector3.UP},
		{"name":"g52-relief-topdown.png", "position":Vector3(128, 520, 128), "target":Vector3(128, 0, 128), "up":Vector3.FORWARD},
	]
	_apply_shot()

func _apply_shot() -> void:
	var shot: Dictionary = _shots[_shot]
	_camera.position = shot["position"]
	_camera.look_at(shot["target"], shot["up"])

func _process(_delta: float) -> bool:
	if _camera == null:
		return false
	_frame += 1
	if _frame < SETTLE_FRAMES:
		return false
	var viewport_texture := root.get_texture()
	if viewport_texture == null:
		_fail("viewport returned no texture")
		return true
	var image := viewport_texture.get_image()
	if image == null or image.is_empty():
		_fail("viewport returned no image")
		return true
	var directory := ProjectSettings.globalize_path(OUTPUT_DIRECTORY)
	DirAccess.make_dir_recursive_absolute(directory)
	var path := directory.path_join(String(_shots[_shot]["name"]))
	if image.save_png(path) != OK:
		_fail("failed to save " + path)
		return true
	print("[g52-relief-render] wrote " + path)
	_shot += 1
	if _shot >= _shots.size():
		print("NE_G52_RELIEF_VISUAL_PROOF_OK baked_vertices=" + str((_probe["terrain3dRegionSize"] + 1) * (_probe["terrain3dRegionSize"] + 1)))
		quit(0)
		return true
	_frame = 0
	_apply_shot()
	return false
