extends SceneTree

const SOURCE_PATH := "res://.terrain3d-proof/g70-hydrology-source.json"
const BAKE_PATH := "res://.terrain3d-proof/g70-hydrology-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g70-hydrology-topdown.png"
const EXPECTED_SCHEMA := "westeros-g70-terrain3d-hydrology-source-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const HEIGHT_TOLERANCE := 0.001
const MAX_ALLOWED_SEAFLOOR_HEIGHT := -2.5

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G70 Terrain3D hydrology proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _channel_value(source: Dictionary, channel: String, u: float, v: float) -> float:
	var values: Array = source[channel]
	var gx := clampf(u, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var gy := clampf(v, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var x0 := int(floor(gx))
	var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, SOURCE_SIZE - 1)
	var y1 := mini(y0 + 1, SOURCE_SIZE - 1)
	var tx := gx - float(x0)
	var ty := gy - float(y0)
	var a := float(values[y0 * SOURCE_SIZE + x0])
	var b := float(values[y0 * SOURCE_SIZE + x1])
	var c := float(values[y1 * SOURCE_SIZE + x0])
	var d := float(values[y1 * SOURCE_SIZE + x1])
	return lerpf(lerpf(a, b, tx), lerpf(c, d, tx), ty)

func _build_height_image(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var height := _channel_value(source, "heights", float(x) / 256.0, float(z) / 256.0)
			image.set_pixel(x, z, Color(height, 0.0, 0.0, 1.0))
	return image

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null:
		_fail("Terrain3D save directory was not created")
		return {}
	var files: Array[String] = []
	var total_bytes := 0
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			files.push_back(name)
			total_bytes += FileAccess.get_file_as_bytes(directory.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end()
	files.sort()
	return {"files": files, "totalBytes": total_bytes}

func _hash_u8(checksum: int, value: int) -> int:
	return int((checksum ^ (value & 0xff)) * 16777619) & 0xffffffff

func _hash_height(checksum: int, value: float) -> int:
	var quantized := int(round(value * 1000000.0))
	var result := checksum
	for shift in [0, 8, 16, 24]:
		result = _hash_u8(result, quantized >> shift)
	return result

func _write_topdown(terrain: Terrain3D) -> Error:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var height := terrain.data.get_height(Vector3(float(x), 0.0, float(z)))
			if is_nan(height):
				return ERR_INVALID_DATA
			var depth := clampf(-height / 12.0, 0.0, 1.0)
			image.set_pixel(x, z, Color(0.03 + 0.04 * (1.0 - depth), 0.16 + 0.12 * (1.0 - depth), 0.38 + 0.22 * (1.0 - depth), 1.0))
	return image.save_png(PREVIEW_PATH)

func _run() -> void:
	if not _require(FileAccess.file_exists(SOURCE_PATH), "G70 source JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(SOURCE_PATH))
	if not _require(parsed is Dictionary, "source JSON did not decode to Dictionary"): return
	var source: Dictionary = parsed
	if not _require(String(source.get("schema", "")) == EXPECTED_SCHEMA, "unexpected source schema"): return
	if not _require(String(source.get("sourceMapSha256", "")) == EXPECTED_MAP_SHA, "map.png provenance changed"): return
	if not _require(String(source.get("geoCell", "")) == "G70", "source GeoCell drifted"): return
	if not _require(int(source.get("width", 0)) == SOURCE_SIZE and int(source.get("height", 0)) == SOURCE_SIZE, "source must remain 65x65"): return
	for channel in ["heights", "waterConfidence"]:
		if not _require(source.has(channel) and source[channel] is Array and (source[channel] as Array).size() == SOURCE_SIZE * SOURCE_SIZE, "invalid source channel " + channel): return
	for value in source["waterConfidence"]:
		if not _require(absf(float(value) - 1.0) <= 0.00000001, "G70 guard-backed source is not unambiguous open sea"): return

	var terrain := Terrain3D.new()
	terrain.name = "G70Terrain3DHydrologyProof"
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	terrain.data.import_images([_build_height_image(source), null, null], Vector3.ZERO, 0.0, 1.0)
	var region_count := terrain.data.get_region_count()
	if not _require(region_count >= 4, "257x257 guard-backed height import did not create four Terrain3D regions"): return

	var max_height_error := 0.0
	var min_imported_height := INF
	var max_imported_height := -INF
	var imported_heights: Array[float] = []
	var checksum: int = 2166136261
	for sy in SOURCE_SIZE:
		var v := float(sy) / 64.0
		for sx in SOURCE_SIZE:
			var u := float(sx) / 64.0
			var pos := Vector3(float(sx * 4), 0.0, float(sy * 4))
			var actual := terrain.data.get_height(pos)
			if not _require(not is_nan(actual), "non-finite Terrain3D aligned height sample"): return
			var expected := _channel_value(source, "heights", u, v)
			max_height_error = maxf(max_height_error, absf(actual - expected))
			min_imported_height = minf(min_imported_height, actual)
			max_imported_height = maxf(max_imported_height, actual)
			if not _require(actual <= MAX_ALLOWED_SEAFLOOR_HEIGHT, "Terrain3D G70 height rose above the canonical minimum water depth"): return
			var snapped := snappedf(actual, 0.000001)
			imported_heights.push_back(snapped)
			checksum = _hash_height(checksum, snapped)
	if not _require(max_height_error <= HEIGHT_TOLERANCE, "aligned Terrain3D height round-trip exceeded tolerance"): return

	var boundary_probe_max_height_error := 0.0
	for px in [254.5, 255.0, 255.5, 256.0]:
		for pz in [0.0, 63.5, 127.5, 191.5, 254.5, 255.5, 256.0]:
			var actual := terrain.data.get_height(Vector3(float(px), 0.0, float(pz)))
			if not _require(not is_nan(actual), "Terrain3D returned NAN at the 255/256 region boundary"): return
			var expected := _channel_value(source, "heights", float(px) / 256.0, float(pz) / 256.0)
			boundary_probe_max_height_error = maxf(boundary_probe_max_height_error, absf(actual - expected))
	if not _require(boundary_probe_max_height_error <= HEIGHT_TOLERANCE, "Terrain3D 255/256 boundary continuity exceeded tolerance"): return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "Terrain3D LOD0 bake returned no mesh"): return
	var baked_vertices: PackedVector3Array = baked_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(baked_vertices.size() > 0, "Terrain3D LOD0 bake returned no vertices"): return

	var suffix := OS.get_environment("G70_HYDROLOGY_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var save_dir := "user://g70-terrain3d-hydrology-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir))
	terrain.data.save_directory(save_dir)
	var saved := _saved_region_evidence(save_dir)
	if not _require(saved["files"].size() >= 4 and int(saved["totalBytes"]) > 0, "Terrain3D did not persist four guard-backed regions"): return
	if not _require(_write_topdown(terrain) == OK, "failed to write imported-height top-down proof"): return

	var bake := {
		"schema": "westeros-g70-terrain3d-hydrology-bake-v1",
		"policyId": String(source.get("policyId", "")),
		"sourceMapSha256": EXPECTED_MAP_SHA,
		"terrain3dVersion": String(terrain.version),
		"lod": 0,
		"width": SOURCE_SIZE,
		"height": SOURCE_SIZE,
		"regionCount": region_count,
		"savedRegionFiles": saved["files"].size(),
		"savedRegionBytes": int(saved["totalBytes"]),
		"bakedSurfaces": baked_mesh.get_surface_count(),
		"bakedVertices": baked_vertices.size(),
		"minImportedHeight": snappedf(min_imported_height, 0.000001),
		"maxImportedHeight": snappedf(max_imported_height, 0.000001),
		"maxHeightError": snappedf(max_height_error, 0.00000001),
		"boundaryProbeMaxHeightError": snappedf(boundary_probe_max_height_error, 0.00000001),
		"bakeChecksum": checksum,
		"heights": imported_heights,
	}
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	var output := FileAccess.open(BAKE_PATH, FileAccess.WRITE)
	if not _require(output != null, "could not open G70 bake JSON output"): return
	output.store_string(JSON.stringify(bake) + "\n")
	output.close()
	print("G70_TERRAIN3D_HYDROLOGY_BAKE_METRICS=" + JSON.stringify({
		"regionCount": region_count,
		"savedRegionFiles": saved["files"].size(),
		"bakedVertices": baked_vertices.size(),
		"minImportedHeight": bake["minImportedHeight"],
		"maxImportedHeight": bake["maxImportedHeight"],
		"maxHeightError": bake["maxHeightError"],
		"boundaryProbeMaxHeightError": bake["boundaryProbeMaxHeightError"],
		"bakeChecksum": checksum,
	}))
	print("NE_G70_TERRAIN3D_HYDROLOGY_BAKE_OK")
	quit(0)
