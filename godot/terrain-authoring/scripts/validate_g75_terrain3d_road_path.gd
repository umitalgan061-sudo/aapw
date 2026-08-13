extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g75-road-path-probe.json"
const EXPECTED_POLICY := "kizil-ufuk-g75-terrain3d-road-path-2026-08-13-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_HEIGHT_ERROR := 0.01

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G75 Terrain3D road/path proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _source_height(probe: Dictionary, u: float, v: float) -> float:
	var rows: Array = probe["heightRows"]
	var size := int(probe["heightGridSize"])
	var gx := clampf(u, 0.0, 1.0) * float(size - 1)
	var gy := clampf(v, 0.0, 1.0) * float(size - 1)
	var x0 := int(floor(gx))
	var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, size - 1)
	var y1 := mini(y0 + 1, size - 1)
	var tx := gx - float(x0)
	var ty := gy - float(y0)
	var top := lerpf(float(rows[y0][x0]), float(rows[y0][x1]), tx)
	var bottom := lerpf(float(rows[y1][x0]), float(rows[y1][x1]), tx)
	return lerpf(top, bottom, ty)

func _build_height_image(probe: Dictionary) -> Image:
	var size := int(probe["terrain3dRegionSize"])
	var image := Image.create_empty(size, size, false, Image.FORMAT_RF)
	for z in size:
		var v := float(z) / float(size - 1)
		for x in size:
			var u := float(x) / float(size - 1)
			image.set_pixel(x, z, Color(_source_height(probe, u, v), 0.0, 0.0, 1.0))
	return image

func _build_control_image(probe: Dictionary) -> Image:
	var size := int(probe["terrain3dRegionSize"])
	var base_id := int(probe["baseTextureId"])
	var road_id := int(probe["roadTextureId"])
	var bits: int = Terrain3DUtil.enc_base(base_id) | Terrain3DUtil.enc_overlay(road_id) | Terrain3DUtil.enc_blend(0)
	var encoded := Terrain3DUtil.as_float(bits)
	var image := Image.create_empty(size, size, false, Image.FORMAT_RF)
	for z in size:
		for x in size:
			image.set_pixel(x, z, Color(encoded, 0.0, 0.0, 1.0))
	return image

func _write_topdown(terrain: Terrain3D, probe: Dictionary) -> Error:
	var size := int(probe["terrain3dRegionSize"])
	var image := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var min_height := INF
	var max_height := -INF
	for z in size:
		for x in size:
			var height := terrain.data.get_height(Vector3(float(x), 0.0, float(z)))
			if not is_nan(height):
				min_height = minf(min_height, height)
				max_height = maxf(max_height, height)
	var span := maxf(max_height - min_height, 0.000001)
	for z in size:
		for x in size:
			var pos := Vector3(float(x), 0.0, float(z))
			var height := terrain.data.get_height(pos)
			if is_nan(height): height = min_height
			var t := clampf((height - min_height) / span, 0.0, 1.0)
			var low := Color(0.29, 0.34, 0.22, 1.0)
			var high := Color(0.48, 0.43, 0.34, 1.0)
			var road := Color(0.62, 0.47, 0.26, 1.0)
			var blend := terrain.data.get_control_blend(pos)
			if is_nan(blend): blend = 0.0
			image.set_pixel(x, z, low.lerp(high, t).lerp(road, clampf(blend, 0.0, 1.0)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	return image.save_png("res://.terrain3d-proof/g75-road-path-imported-topdown.png")

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null:
		_fail("Terrain3D save directory was not created")
		return {}
	var files := 0
	var total_bytes := 0
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			files += 1
			total_bytes += FileAccess.get_file_as_bytes(directory.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end()
	return {"files": files, "totalBytes": total_bytes}

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON invalid"): return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "policy changed"): return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "map.png SHA changed"): return
	if not _require(int(probe["sourceGridSize"]) == 257, "road source must be 257x257"): return
	if not _require(int(probe["heightGridSize"]) == 65, "merged relief source must be 65x65"): return
	if not _require(int(probe["terrain3dRegionSize"]) == 256, "Terrain3D region must be 256"): return
	if not _require(int(probe["canonicalWaterCells"]) == 0 and int(probe["canonicalLandCells"]) == 96, "G75 hydrology drifted"): return
	if not _require((probe["crossingEdges"] as Array).is_empty(), "runtime road/path entered G75"): return
	if not _require(int(probe["activeRoadSamples"]) == 0 and int(probe["activePathSamples"]) == 0, "G75 gained invented road/path coverage"): return

	var terrain := Terrain3D.new()
	terrain.name = "G75Terrain3DRoadPathProof"
	get_root().add_child(terrain)
	terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return

	var height_image := _build_height_image(probe)
	var control_image := _build_control_image(probe)
	terrain.data.import_images([height_image, control_image, null], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 1, "real Terrain3D region was not created"): return

	var sample_positions: Array[int] = []
	for coordinate in range(0, 256, 16): sample_positions.push_back(coordinate)
	if sample_positions[-1] != 255: sample_positions.push_back(255)
	var max_height_error := 0.0
	var checksum: int = 2166136261
	var sample_count := 0
	for z in sample_positions:
		for x in sample_positions:
			var pos := Vector3(float(x), 0.0, float(z))
			var expected_height := _source_height(probe, float(x) / 255.0, float(z) / 255.0)
			var actual_height := terrain.data.get_height(pos)
			if not _require(not is_nan(actual_height), "imported height returned NAN"): return
			max_height_error = maxf(max_height_error, absf(actual_height - expected_height))
			var blend := terrain.data.get_control_blend(pos)
			if not _require(not is_nan(blend), "control blend returned NAN"): return
			if not _require(absf(blend) <= 0.000001, "Terrain3D imported non-zero road coverage into G75"): return
			checksum = int((checksum ^ int(round(actual_height * 100.0))) * 16777619) & 0xffffffff
			checksum = int((checksum ^ int(round(blend * 255.0))) * 16777619) & 0xffffffff
			sample_count += 1
	if not _require(max_height_error <= MAX_HEIGHT_ERROR, "Terrain3D merged-relief roundtrip exceeded tolerance"): return

	if not _require(_write_topdown(terrain, probe) == OK, "top-down proof could not be saved"): return
	var mesh: Mesh = terrain.bake_mesh(0)
	if not _require(mesh != null and mesh.get_surface_count() > 0, "LOD0 bake returned no mesh"): return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "LOD0 bake returned no vertices"): return

	var suffix := OS.get_environment("G75_ROAD_PATH_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var output_dir := "user://g75-terrain3d-road-path-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	terrain.data.save_directory(output_dir)
	var saved := _saved_region_evidence(output_dir)
	if not _require(int(saved["files"]) >= 1 and int(saved["totalBytes"]) > 0, "Terrain3D region resource was not persisted"): return

	var metrics := {
		"terrain3dVersion": String(terrain.version),
		"regionSize": int(terrain.region_size),
		"regionCount": terrain.data.get_region_count(),
		"sampleCount": sample_count,
		"maxHeightError": snappedf(max_height_error, 0.00000001),
		"outputChecksum": checksum,
		"bakedSurfaces": mesh.get_surface_count(),
		"bakedVertices": vertices.size(),
		"savedRegionFiles": int(saved["files"]),
		"savedRegionBytes": int(saved["totalBytes"]),
	}
	print("G75_TERRAIN3D_ROAD_PATH_METRICS=" + JSON.stringify(metrics))
	print("SE_G75_TERRAIN3D_ROAD_PATH_VALIDATION_OK")
	quit(0)
