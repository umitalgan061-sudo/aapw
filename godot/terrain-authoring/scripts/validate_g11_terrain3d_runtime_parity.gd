extends SceneTree

const DEFAULT_SOURCE_PATH := "res://.terrain3d-proof/g11-runtime-source.json"
const DEFAULT_BAKE_PATH := "res://.terrain3d-proof/g11-runtime-bake.json"
const REGION_SIZE := 256

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G11 Terrain3D runtime parity failed: " + message)
	quit(1)

func _proof_path(env_name: String, fallback: String) -> String:
	var configured := OS.get_environment(env_name)
	return configured if not configured.is_empty() else fallback

func _sample_source(source: Dictionary, u: float, v: float) -> float:
	var w := int(source["width"])
	var h := int(source["height"])
	var heights: Array = source["heights"]
	var gx := clampf(u, 0.0, 1.0) * float(w - 1)
	var gy := clampf(v, 0.0, 1.0) * float(h - 1)
	var x0 := int(floor(gx)); var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, w - 1); var y1 := mini(y0 + 1, h - 1)
	var tx := gx - float(x0); var ty := gy - float(y0)
	var a := lerpf(float(heights[y0 * w + x0]), float(heights[y0 * w + x1]), tx)
	var b := lerpf(float(heights[y1 * w + x0]), float(heights[y1 * w + x1]), tx)
	return lerpf(a, b, ty)

func _run() -> void:
	var source_path := _proof_path("G11_RUNTIME_SOURCE_PATH", DEFAULT_SOURCE_PATH)
	var bake_path := _proof_path("G11_RUNTIME_BAKE_PATH", DEFAULT_BAKE_PATH)
	if not FileAccess.file_exists(source_path):
		_fail("source probe missing at " + source_path); return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(source_path))
	if not (parsed is Dictionary):
		_fail("source probe invalid"); return
	var source: Dictionary = parsed
	if String(source.get("schema", "")) != "westeros-g11-runtime-source-v1":
		_fail("source schema mismatch"); return

	var image := Image.create_empty(REGION_SIZE, REGION_SIZE, false, Image.FORMAT_RF)
	for z in REGION_SIZE:
		var v := float(z) / float(REGION_SIZE - 1)
		for x in REGION_SIZE:
			var u := float(x) / float(REGION_SIZE - 1)
			image.set_pixel(x, z, Color(_sample_source(source, u, v), 0, 0, 1))

	var terrain := Terrain3D.new()
	terrain.name = "G11Terrain3DRuntimeParity"
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not String(terrain.version).begins_with("1.0.2"):
		_fail("pinned Terrain3D 1.0.2 not loaded"); return
	terrain.data.import_images([image, null, null], Vector3.ZERO, 0.0, 1.0)
	if terrain.data.get_region_count() < 1:
		_fail("real Terrain3D region import missing"); return

	var mesh: Mesh = terrain.bake_mesh(0)
	if mesh == null or mesh.get_surface_count() < 1:
		_fail("LOD0 bake produced no surface"); return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if vertices.is_empty():
		_fail("LOD0 bake produced no vertices"); return

	var out_heights: Array = []
	var w := int(source["width"]); var h := int(source["height"])
	var max_roundtrip := 0.0
	for y in h:
		var v := float(y) / float(h - 1)
		for x in w:
			var u := float(x) / float(w - 1)
			var px := u * float(REGION_SIZE - 1)
			var pz := v * float(REGION_SIZE - 1)
			var actual := terrain.data.get_height(Vector3(px, 0.0, pz))
			if is_nan(actual):
				_fail("Terrain3D returned NaN"); return
			var expected := _sample_source(source, u, v)
			max_roundtrip = maxf(max_roundtrip, absf(actual - expected))
			out_heights.push_back(actual)

	var save_dir := "user://g11-runtime-parity-regions"
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir))
	terrain.data.save_directory(save_dir)
	var dir := DirAccess.open(save_dir)
	if dir == null:
		_fail("region persistence directory missing"); return
	var saved_files := 0
	for filename in dir.get_files():
		if filename.ends_with(".res"): saved_files += 1
	if saved_files < 1:
		_fail("region persistence produced no resource"); return

	var bake := {
		"schema": "westeros-g11-terrain3d-bake-v1",
		"width": w,
		"height": h,
		"normalizedBounds": source["normalizedBounds"],
		"heights": out_heights,
		"terrain3dVersion": String(terrain.version),
		"regionCount": terrain.data.get_region_count(),
		"bakedSurfaces": mesh.get_surface_count(),
		"bakedVertices": vertices.size(),
		"savedRegionFiles": saved_files,
		"maxRoundtripError": max_roundtrip
	}
	DirAccess.make_dir_recursive_absolute(bake_path.get_base_dir())
	var file := FileAccess.open(bake_path, FileAccess.WRITE)
	if file == null:
		_fail("could not open bake path " + bake_path); return
	file.store_string(JSON.stringify(bake))
	file.close()
	var metrics := bake.duplicate()
	metrics["heights"] = []
	metrics["sourcePath"] = source_path
	metrics["bakePath"] = bake_path
	print("G11_TERRAIN3D_RUNTIME_BAKE_METRICS=" + JSON.stringify(metrics))
	print("NW_G11_TERRAIN3D_RUNTIME_BAKE_OK")
	quit(0)
