extends SceneTree

const SOURCE_PATH := "res://.terrain3d-proof/g11-runtime-source.json"
const BAKE_PATH := "res://.terrain3d-proof/g11-runtime-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g11-runtime-imported-topdown.png"
const REGION_SIZE := 256
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_ROUNDTRIP_ERROR := 0.01

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

func _finite(value: float) -> bool:
	return not is_nan(value) and not is_inf(value)

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

func _write_preview(terrain: Terrain3D, min_height: float, max_height: float) -> bool:
	var preview := Image.create_empty(REGION_SIZE, REGION_SIZE, false, Image.FORMAT_RGB8)
	var span := maxf(max_height - min_height, 0.0001)
	for z in REGION_SIZE:
		for x in REGION_SIZE:
			var height := terrain.data.get_height(Vector3(float(x), 0.0, float(z)))
			if not _finite(height):
				return false
			var t := clampf((height - min_height) / span, 0.0, 1.0)
			preview.set_pixel(x, z, Color(0.12, 0.18, 0.22).lerp(Color(0.82, 0.86, 0.90), t))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(PREVIEW_PATH).get_base_dir())
	return preview.save_png(PREVIEW_PATH) == OK

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
	if not _require(String(source.get("sourceMapSha256", "")) == EXPECTED_SOURCE_SHA, "map.png source SHA mismatch"):
		return
	if not _require(int(source.get("width", 0)) == 65 and int(source.get("height", 0)) == 65, "source grid must be 65x65"):
		return
	var source_heights: Array = source["heights"]
	if not _require(source_heights.size() == 65 * 65, "source payload size mismatch"):
		return
	var min_source := INF
	var max_source := -INF
	for i in source_heights.size():
		var value := float(source_heights[i])
		if not _require(_finite(value), "non-finite Three.js source height at index %d" % i):
			return
		min_source = minf(min_source, value)
		max_source = maxf(max_source, value)

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

	# Capture imported Terrain3D data before mesh baking. This is the deterministic
	# height payload exported to Three.js; bake_mesh is then proven separately below.
	# Keeping these stages distinct avoids conflating data round-trip with mesh generation.
	print("G11_TERRAIN3D_STAGE=roundtrip")
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
			if not _require(_finite(actual), "Terrain3D returned non-finite height at source=(%d,%d) terrain=(%.6f,%.6f)" % [x, y, px, pz]):
				return
			var expected := _sample_source(source, u, v)
			max_roundtrip = maxf(max_roundtrip, absf(actual - expected))
			out_heights.push_back(actual)
	if not _require(max_roundtrip <= MAX_ROUNDTRIP_ERROR, "Terrain3D height roundtrip exceeded 0.01 m"):
		return

	print("G11_TERRAIN3D_STAGE=bake")
	var mesh: Mesh = terrain.bake_mesh(0)
	if not _require(mesh != null and mesh.get_surface_count() >= 1, "LOD0 bake produced no surface"):
		return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(not vertices.is_empty(), "LOD0 bake produced no vertices"):
		return
	for i in vertices.size():
		var vertex := vertices[i]
		if not _require(_finite(vertex.x) and _finite(vertex.y) and _finite(vertex.z), "LOD0 bake produced non-finite vertex at index %d" % i):
			return

	print("G11_TERRAIN3D_STAGE=persist")
	var suffix := OS.get_environment("G11_PARITY_PROOF_SUFFIX")
	if suffix.is_empty():
		suffix = "default"
	var save_dir := "user://g11-runtime-parity-regions-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir))
	terrain.data.save_directory(save_dir)
	var saved := _saved_region_evidence(save_dir)
	if not _require(int(saved["files"]) >= 1 and int(saved["bytes"]) > 0, "region persistence produced no non-empty resource"):
		return
	if not _require(_write_preview(terrain, min_source, max_source), "imported top-down preview contains non-finite Terrain3D height"):
		return

	var bake := {
		"schema": "westeros-g11-terrain3d-bake-v1",
		"width": w,
		"height": h,
		"normalizedBounds": source["normalizedBounds"],
		"sourceMapSha256": EXPECTED_SOURCE_SHA,
		"heights": out_heights,
		"terrain3dVersion": String(terrain.version),
		"regionCount": terrain.data.get_region_count(),
		"bakedSurfaces": mesh.get_surface_count(),
		"bakedVertices": vertices.size(),
		"savedRegionFiles": int(saved["files"]),
		"savedRegionBytes": int(saved["bytes"]),
		"maxRoundtripError": max_roundtrip,
		"previewPath": PREVIEW_PATH
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
