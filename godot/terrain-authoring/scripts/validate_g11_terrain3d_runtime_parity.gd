extends SceneTree

const SOURCE_PATH := "res://.terrain3d-proof/g11-runtime-source.json"
const BAKE_PATH := "res://.terrain3d-proof/g11-runtime-bake.json"
const REGION_SIZE := 256

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G11 Terrain3D runtime parity failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

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

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null:
		return {"files": 0, "bytes": 0}
	var files := 0
	var bytes := 0
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			files += 1
			bytes += FileAccess.get_file_as_bytes(directory.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end()
	return {"files": files, "bytes": bytes}

func _run() -> void:
	print("G11_TERRAIN3D_STAGE=source")
	if not _require(FileAccess.file_exists(SOURCE_PATH), "source probe missing"):
		return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(SOURCE_PATH))
	if not _require(parsed is Dictionary, "source probe invalid"):
		return
	var source: Dictionary = parsed
	if not _require(String(source.get("schema", "")) == "westeros-g11-runtime-source-v1", "source schema mismatch"):
		return
	if not _require(int(source.get("width", 0)) == 65 and int(source.get("height", 0)) == 65, "source grid must be 65x65"):
		return

	print("G11_TERRAIN3D_STAGE=image")
	var image := Image.create_empty(REGION_SIZE, REGION_SIZE, false, Image.FORMAT_RF)
	for z in REGION_SIZE:
		var v := float(z) / float(REGION_SIZE - 1)
		for x in REGION_SIZE:
			var u := float(x) / float(REGION_SIZE - 1)
			image.set_pixel(x, z, Color(_sample_source(source, u, v), 0.0, 0.0, 1.0))

	print("G11_TERRAIN3D_STAGE=import")
	var terrain := Terrain3D.new()
	terrain.name = "G11Terrain3DRuntimeParity"
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D 1.0.2 not loaded"):
		return
	terrain.data.import_images([image, null, null], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 1, "real Terrain3D region import missing"):
		return

	print("G11_TERRAIN3D_STAGE=bake")
	var mesh: Mesh = terrain.bake_mesh(0)
	if not _require(mesh != null and mesh.get_surface_count() >= 1, "LOD0 bake produced no surface"):
		return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(not vertices.is_empty(), "LOD0 bake produced no vertices"):
		return

	print("G11_TERRAIN3D_STAGE=roundtrip")
	var out_heights: Array = []
	var w := int(source["width"]); var h := int(source["height"])
	var max_roundtrip := 0.0
	for y in h:
		var v := float(y) / float(h - 1)
		for x in w:
			var u := float(x) / float(w - 1)
			var actual := terrain.data.get_height(Vector3(u * float(REGION_SIZE - 1), 0.0, v * float(REGION_SIZE - 1)))
			if not _require(not is_nan(actual), "Terrain3D returned NaN"):
				return
			var expected := _sample_source(source, u, v)
			max_roundtrip = maxf(max_roundtrip, absf(actual - expected))
			out_heights.push_back(actual)

	print("G11_TERRAIN3D_STAGE=persist")
	var save_dir := "user://g11-runtime-parity-regions"
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir))
	terrain.data.save_directory(save_dir)
	var saved := _saved_region_evidence(save_dir)
	if not _require(int(saved["files"]) >= 1 and int(saved["bytes"]) > 0, "region persistence produced no non-empty resource"):
		return

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
		"savedRegionFiles": int(saved["files"]),
		"savedRegionBytes": int(saved["bytes"]),
		"maxRoundtripError": max_roundtrip
	}
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	var file := FileAccess.open(BAKE_PATH, FileAccess.WRITE)
	if not _require(file != null, "could not open bake output"):
		return
	file.store_string(JSON.stringify(bake)); file.close()
	var metrics := bake.duplicate(); metrics["heights"] = []
	print("G11_TERRAIN3D_RUNTIME_BAKE_METRICS=" + JSON.stringify(metrics))
	print("NW_G11_TERRAIN3D_RUNTIME_BAKE_OK")
	quit(0)
