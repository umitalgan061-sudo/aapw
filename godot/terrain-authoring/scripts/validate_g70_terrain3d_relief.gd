extends SceneTree

const SOURCE_PATH := "res://.terrain3d-proof/g70-relief-source.json"
const METRICS_PATH := "res://.terrain3d-proof/g70-relief-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g70-relief-imported-topdown.png"
const EXPECTED_SCHEMA := "westeros-g70-terrain3d-relief-source-v1"
const EXPECTED_POLICY := "safak-kartali-g70-terrain3d-relief-2026-08-13-v1"
const EXPECTED_HYDROLOGY_POLICY := "safak-kartali-g70-terrain3d-hydrology-2026-08-13-v1"
const EXPECTED_BIOME_POLICY := "safak-kartali-g70-terrain3d-biome-2026-08-13-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const HEIGHT_TOLERANCE := 0.001
const SEAM_TOLERANCE := 0.001
const MAX_ALLOWED_SEAFLOOR_HEIGHT := -2.5

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G70 Terrain3D Relief proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _source_height(source: Dictionary, u: float, v: float) -> float:
	var values: Array = source["heights"]
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
		var v := float(z) / float(IMPORT_SIZE - 1)
		for x in IMPORT_SIZE:
			var u := float(x) / float(IMPORT_SIZE - 1)
			image.set_pixel(x, z, Color(_source_height(source, u, v), 0.0, 0.0, 1.0))
	return image

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null:
		_fail("Terrain3D relief save directory was not created")
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

func _write_preview(terrain: Terrain3D) -> Error:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGB8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var height := terrain.data.get_height(Vector3(float(x), 0.0, float(z)))
			if is_nan(height):
				return ERR_INVALID_DATA
			var depth_t := clampf(absf(height) / 16.0, 0.0, 1.0)
			image.set_pixel(x, z, Color(0.16, 0.30, 0.36).lerp(Color(0.05, 0.13, 0.18), depth_t))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	return image.save_png(PREVIEW_PATH)

func _hash_height(checksum: int, value: float) -> int:
	var quantized := int(round((value + 128.0) * 1000.0))
	return int((checksum ^ quantized) * 16777619) & 0xffffffff

func _run() -> void:
	if not _require(FileAccess.file_exists(SOURCE_PATH), "G70 relief source JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(SOURCE_PATH))
	if not _require(parsed is Dictionary, "relief source JSON did not decode to Dictionary"): return
	var source: Dictionary = parsed
	if not _require(String(source.get("schema", "")) == EXPECTED_SCHEMA, "unexpected relief source schema"): return
	if not _require(String(source.get("policyId", "")) == EXPECTED_POLICY, "unexpected relief policy"): return
	if not _require(String(source.get("hydrologyPolicyId", "")) == EXPECTED_HYDROLOGY_POLICY, "merged Hydrology provenance drifted"): return
	if not _require(String(source.get("biomePolicyId", "")) == EXPECTED_BIOME_POLICY, "merged Biome provenance drifted"): return
	if not _require(String(source.get("sourceMapSha256", "")) == EXPECTED_MAP_SHA, "map.png provenance changed"): return
	if not _require(String(source.get("geoCell", "")) == "G70", "source GeoCell drifted"): return
	if not _require(int(source.get("width", 0)) == SOURCE_SIZE and int(source.get("height", 0)) == SOURCE_SIZE, "source must remain 65x65"): return
	if not _require(int(source.get("terrain3dImportSize", 0)) == IMPORT_SIZE, "proof must retain 257x257 import"): return
	if not _require(int(source.get("terrain3dRegionSize", 0)) == REGION_SIZE, "proof must retain region_size 256"): return
	if not _require(source.has("heights") and source["heights"] is Array and (source["heights"] as Array).size() == SOURCE_SIZE * SOURCE_SIZE, "invalid relief height channel"): return
	var canonical_height := float(source["heights"][0])
	if not _require(canonical_height <= MAX_ALLOWED_SEAFLOOR_HEIGHT, "canonical G70 relief seafloor is too shallow"): return
	for value in source["heights"]:
		if not _require(absf(float(value) - canonical_height) <= 0.00000001, "G70 Relief invented local submarine height variation"): return

	var terrain := Terrain3D.new()
	terrain.name = "G70Terrain3DReliefProof"
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	terrain.data.import_images([_build_height_image(source), null, null], Vector3.ZERO, 0.0, 1.0)
	var region_count := terrain.data.get_region_count()
	if not _require(region_count >= 4, "257x257 relief import did not create four Terrain3D regions"): return

	var max_height_error := 0.0
	var min_imported := INF
	var max_imported := -INF
	var output_checksum: int = 2166136261
	var aligned_samples := 0
	for sy in SOURCE_SIZE:
		var v := float(sy) / 64.0
		for sx in SOURCE_SIZE:
			var u := float(sx) / 64.0
			var actual := terrain.data.get_height(Vector3(float(sx * 4), 0.0, float(sy * 4)))
			if not _require(not is_nan(actual), "Terrain3D returned NAN for aligned G70 relief"): return
			var expected := _source_height(source, u, v)
			max_height_error = maxf(max_height_error, absf(actual - expected))
			min_imported = minf(min_imported, actual)
			max_imported = maxf(max_imported, actual)
			output_checksum = _hash_height(output_checksum, actual)
			aligned_samples += 1
	if not _require(max_height_error <= HEIGHT_TOLERANCE, "Terrain3D aligned relief round-trip exceeded tolerance"): return
	if not _require(max_imported <= MAX_ALLOWED_SEAFLOOR_HEIGHT, "Terrain3D Relief raised G70 above canonical water depth"): return
	if not _require(absf(max_imported - min_imported) <= HEIGHT_TOLERANCE, "Terrain3D invented G70 local bathymetry"): return

	var seam_axis := [254.5, 255.0, 255.5, 256.0]
	var cross_axis := [32.25, 96.5, 160.75, 224.5]
	var max_seam_error := 0.0
	var max_seam_pair_delta := 0.0
	var seam_samples := 0
	for boundary in seam_axis:
		for cross in cross_axis:
			var points = [Vector2(boundary, cross), Vector2(cross, boundary)]
			for point in points:
				var actual := terrain.data.get_height(Vector3(point.x, 0.0, point.y))
				if not _require(not is_nan(actual), "Terrain3D returned NAN on G70 255/256 relief seam"): return
				var expected := _source_height(source, point.x / 256.0, point.y / 256.0)
				max_seam_error = maxf(max_seam_error, absf(actual - expected))
				max_seam_pair_delta = maxf(max_seam_pair_delta, absf(actual - canonical_height))
				seam_samples += 1
	for z in seam_axis:
		for x in seam_axis:
			var actual := terrain.data.get_height(Vector3(float(x), 0.0, float(z)))
			if not _require(not is_nan(actual), "Terrain3D returned NAN at G70 seam intersection"): return
			max_seam_error = maxf(max_seam_error, absf(actual - canonical_height))
			max_seam_pair_delta = maxf(max_seam_pair_delta, absf(actual - canonical_height))
			seam_samples += 1
	if not _require(max_seam_error <= SEAM_TOLERANCE, "Terrain3D G70 255/256 relief seam exceeded tolerance"): return
	if not _require(max_seam_pair_delta <= SEAM_TOLERANCE, "Terrain3D G70 seam developed synthetic height character"): return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "Terrain3D LOD0 relief bake returned no mesh"): return
	var baked_vertices: PackedVector3Array = baked_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(baked_vertices.size() > 0, "Terrain3D LOD0 relief bake returned no vertices"): return

	var suffix := OS.get_environment("G70_RELIEF_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var save_dir := "user://g70-terrain3d-relief-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir))
	terrain.data.save_directory(save_dir)
	var saved := _saved_region_evidence(save_dir)
	if not _require(saved["files"].size() >= 4 and int(saved["totalBytes"]) > 0, "Terrain3D did not persist four relief regions"): return
	if not _require(_write_preview(terrain) == OK, "failed to write imported G70 relief top-down proof"): return

	var metrics := {
		"schema": "westeros-g70-terrain3d-relief-bake-v1",
		"policyId": EXPECTED_POLICY,
		"sourceMapSha256": EXPECTED_MAP_SHA,
		"terrain3dVersion": String(terrain.version),
		"regionSize": int(terrain.region_size),
		"regionCount": region_count,
		"canonicalHeight": snappedf(canonical_height, 0.000001),
		"alignedSamples": aligned_samples,
		"seamSamples": seam_samples,
		"maxHeightError": snappedf(max_height_error, 0.00000001),
		"maxSeamHeightError": snappedf(max_seam_error, 0.00000001),
		"maxSeamPairDelta": snappedf(max_seam_pair_delta, 0.00000001),
		"minImportedHeight": snappedf(min_imported, 0.000001),
		"maxImportedHeight": snappedf(max_imported, 0.000001),
		"outputChecksum": output_checksum,
		"bakedSurfaces": baked_mesh.get_surface_count(),
		"bakedVertices": baked_vertices.size(),
		"savedRegionFiles": saved["files"].size(),
		"savedRegionBytes": int(saved["totalBytes"]),
	}
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	var output := FileAccess.open(METRICS_PATH, FileAccess.WRITE)
	if not _require(output != null, "could not open G70 relief metrics output"): return
	output.store_string(JSON.stringify(metrics) + "\n")
	output.close()
	print("G70_TERRAIN3D_RELIEF_METRICS=" + JSON.stringify(metrics))
	print("NE_G70_TERRAIN3D_RELIEF_VALIDATION_OK")
	quit(0)
