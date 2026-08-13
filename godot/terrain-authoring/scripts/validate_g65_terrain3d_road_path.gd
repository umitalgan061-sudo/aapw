extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g65-road-path-probe.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g65-road-path-imported-topdown.png"
const EXPECTED_POLICY := "kizil-ufuk-g65-terrain3d-road-path-2026-08-13-v2"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_HEIGHT_ERROR := 0.012
const MAX_BLEND_ERROR := 0.006
const MAX_SEAM_HEIGHT_ERROR := 0.02
const MAX_SEAM_BLEND_ERROR := 0.006

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G65 Terrain3D Road/Path proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _source_value(probe: Dictionary, channel: int, u: float, v: float) -> float:
	var rows: Array = probe["rows"]
	var size := int(probe["sourceGridSize"])
	var gx := clampf(u, 0.0, 1.0) * float(size - 1)
	var gy := clampf(v, 0.0, 1.0) * float(size - 1)
	var x0 := int(floor(gx))
	var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, size - 1)
	var y1 := mini(y0 + 1, size - 1)
	var tx := gx - float(x0)
	var ty := gy - float(y0)
	var a := float(rows[y0][x0][channel])
	var b := float(rows[y0][x1][channel])
	var c := float(rows[y1][x0][channel])
	var d := float(rows[y1][x1][channel])
	return lerpf(lerpf(a, b, tx), lerpf(c, d, tx), ty)

func _validate_preserved_source(probe: Dictionary) -> bool:
	var source_samples := 0
	var max_snow := 0.0
	for row_variant in probe["rows"]:
		var row: Array = row_variant
		for sample_variant in row:
			var sample: Array = sample_variant
			source_samples += 1
			max_snow = maxf(max_snow, float(sample[2]))
			if not _require(absf(float(sample[5])) <= 0.00000001, "phantom road weight present in G65 source probe"): return false
			if not _require(absf(float(sample[6])) <= 0.00000001, "phantom path weight present in G65 source probe"): return false
			if not _require(int(sample[7]) == 0, "phantom road/path kind present in G65 source probe"): return false
	if not _require(source_samples == 4225, "expected 65x65 Road/Path source probe"): return false
	return _require(max_snow <= 0.00000001, "Road/Path source regressed warm G65 zero-snow contract")

func _build_height_image(probe: Dictionary) -> Image:
	var import_size := int(probe["terrain3dImportSize"])
	var image := Image.create_empty(import_size, import_size, false, Image.FORMAT_RF)
	for z in import_size:
		var v := float(z) / float(import_size - 1)
		for x in import_size:
			var u := float(x) / float(import_size - 1)
			image.set_pixel(x, z, Color(_source_value(probe, 4, u, v), 0.0, 0.0, 1.0))
	return image

func _build_control_image(probe: Dictionary) -> Image:
	var import_size := int(probe["terrain3dImportSize"])
	var ground_id := int(probe["groundTextureId"])
	var rock_id := int(probe["rockTextureId"])
	var image := Image.create_empty(import_size, import_size, false, Image.FORMAT_RF)
	for z in import_size:
		var v := float(z) / float(import_size - 1)
		for x in import_size:
			var u := float(x) / float(import_size - 1)
			var blend_u8 := int(round(clampf(_source_value(probe, 3, u, v), 0.0, 1.0) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(ground_id) | Terrain3DUtil.enc_overlay(rock_id) | Terrain3DUtil.enc_blend(blend_u8)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0.0, 0.0, 1.0))
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

func _write_preview(terrain: Terrain3D, size: int) -> bool:
	var preview := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	for z in size:
		for x in size:
			var blend := terrain.data.get_control_blend(Vector3(float(x), 0.0, float(z)))
			if is_nan(blend): return false
			var ground := Color(0.31, 0.43, 0.24, 1.0)
			var rock := Color(0.31, 0.30, 0.28, 1.0)
			preview.set_pixel(x, z, ground.lerp(rock, clampf(blend, 0.0, 1.0)))
	var absolute := ProjectSettings.globalize_path(PREVIEW_PATH)
	DirAccess.make_dir_recursive_absolute(absolute.get_base_dir())
	return preview.save_png(PREVIEW_PATH) == OK

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "G65 Road/Path probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON did not decode to Dictionary"): return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected G65 Road/Path policy"): return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "owner-map SHA changed"): return
	if not _require(int(probe["sourceGridSize"]) == 65, "source probe must remain 65x65"): return
	if not _require(int(probe["terrain3dRegionSize"]) == 256 and int(probe["terrain3dImportSize"]) == 257, "proof must preserve 257 import over region size 256"): return
	if not _require(float(probe["canonicalRoadExclusionMarginMeters"]) > 100.0, "canonical G65 road exclusion margin is no longer safe"): return
	if not _require((probe["crossingEdges"] as Array).is_empty(), "runtime road/path now crosses G65"): return
	if not _require(int(probe["activeRoadSamples"]) == 0 and int(probe["activePathSamples"]) == 0, "Road/Path metrics contain active eastern road material"): return
	if not _validate_preserved_source(probe): return

	var ground_id := int(probe["groundTextureId"])
	var rock_id := int(probe["rockTextureId"])
	var road_id := int(probe["roadTextureId"])
	var path_id := int(probe["pathTextureId"])
	if not _require(road_id != ground_id and road_id != rock_id, "road texture slot must remain distinct"): return
	if not _require(path_id != ground_id and path_id != rock_id and path_id != road_id, "path texture slot must remain distinct"): return

	var terrain := Terrain3D.new()
	terrain.name = "G65Terrain3DRoadPathProof"
	get_root().add_child(terrain)
	terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return

	terrain.data.import_images([_build_height_image(probe), _build_control_image(probe), null], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 4, "257x257 preserved Height+Control import must produce four regions"): return

	var max_height_error := 0.0
	var max_blend_error := 0.0
	var output_checksum: int = 2166136261
	var aligned_samples := 0
	for sy in 65:
		for sx in 65:
			var x := sx * 4
			var z := sy * 4
			var u := float(sx) / 64.0
			var v := float(sy) / 64.0
			var pos := Vector3(float(x), 0.0, float(z))
			var actual_height := terrain.data.get_height(pos)
			if not _require(not is_nan(actual_height), "Terrain3D height returned NaN at aligned Road/Path sample"): return
			max_height_error = maxf(max_height_error, absf(actual_height - _source_value(probe, 4, u, v)))
			if not _require(terrain.data.get_control_base_id(pos) == ground_id, "Terrain3D preserved base texture ID changed"): return
			if not _require(terrain.data.get_control_overlay_id(pos) == rock_id, "phantom Road/Path overlay appeared in Terrain3D"): return
			var actual_blend := terrain.data.get_control_blend(pos)
			if not _require(not is_nan(actual_blend), "Terrain3D preserved Rock/Snow blend returned NaN"): return
			max_blend_error = maxf(max_blend_error, absf(actual_blend - _source_value(probe, 3, u, v)))
			output_checksum = int((output_checksum ^ int(round(clampf(actual_blend, 0.0, 1.0) * 255.0))) * 16777619) & 0xffffffff
			aligned_samples += 1
	if not _require(max_height_error <= MAX_HEIGHT_ERROR, "Terrain3D Road/Path preserved height exceeded tolerance"): return
	if not _require(max_blend_error <= MAX_BLEND_ERROR, "Terrain3D Road/Path preserved Rock/Snow blend exceeded tolerance"): return

	var seam_positions := [254.75, 255.0, 255.25, 255.5, 255.75, 256.0]
	var max_seam_height_error := 0.0
	var seam_samples := 0
	for z in [64.5, 128.5, 192.5, 255.5]:
		for x in seam_positions:
			var actual := terrain.data.get_height(Vector3(x, 0.0, z))
			if not _require(not is_nan(actual), "Terrain3D height returned NaN across x=255/256 Road/Path seam"): return
			max_seam_height_error = maxf(max_seam_height_error, absf(actual - _source_value(probe, 4, x / 256.0, z / 256.0)))
			seam_samples += 1
	for x in [64.5, 128.5, 192.5, 255.5]:
		for z in seam_positions:
			var actual := terrain.data.get_height(Vector3(x, 0.0, z))
			if not _require(not is_nan(actual), "Terrain3D height returned NaN across z=255/256 Road/Path seam"): return
			max_seam_height_error = maxf(max_seam_height_error, absf(actual - _source_value(probe, 4, x / 256.0, z / 256.0)))
			seam_samples += 1
	if not _require(max_seam_height_error <= MAX_SEAM_HEIGHT_ERROR, "Terrain3D Road/Path region-seam height parity exceeded tolerance"): return

	var max_seam_blend_error := 0.0
	var control_seam_samples := 0
	for seam in [255.0, 256.0]:
		for cross in [64.0, 128.0, 192.0, 255.0, 256.0]:
			for p in [Vector3(seam, 0.0, cross), Vector3(cross, 0.0, seam)]:
				if not _require(terrain.data.get_control_base_id(p) == ground_id and terrain.data.get_control_overlay_id(p) == rock_id, "Terrain3D preserved control IDs changed at Road/Path seam"): return
				var actual_blend := terrain.data.get_control_blend(p)
				if not _require(not is_nan(actual_blend), "Terrain3D control blend returned NaN at Road/Path seam"): return
				var expected_blend := _source_value(probe, 3, p.x / 256.0, p.z / 256.0)
				max_seam_blend_error = maxf(max_seam_blend_error, absf(actual_blend - expected_blend))
				control_seam_samples += 1
	if not _require(max_seam_blend_error <= MAX_SEAM_BLEND_ERROR, "Terrain3D Road/Path region-seam control parity exceeded tolerance"): return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "Terrain3D LOD0 Road/Path bake returned no mesh"): return
	var vertices: PackedVector3Array = baked_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "Terrain3D LOD0 Road/Path bake returned no vertices"): return

	var suffix := OS.get_environment("G65_ROAD_PATH_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var output_dir := "user://g65-terrain3d-road-path-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	terrain.data.save_directory(output_dir)
	var saved := _saved_region_evidence(output_dir)
	if not _require(saved["files"].size() >= 4 and int(saved["totalBytes"]) > 0, "Terrain3D Road/Path region resources were not persisted"): return
	if not _require(_write_preview(terrain, 257), "failed to write imported Road/Path top-down evidence"): return

	var metrics := {
		"terrain3dVersion": String(terrain.version),
		"regionSize": int(terrain.region_size),
		"regionCount": terrain.data.get_region_count(),
		"alignedSamples": aligned_samples,
		"seamSamples": seam_samples,
		"controlSeamSamples": control_seam_samples,
		"maxHeightError": snappedf(max_height_error, 0.00000001),
		"maxBlendError": snappedf(max_blend_error, 0.00000001),
		"maxSeamHeightError": snappedf(max_seam_height_error, 0.00000001),
		"maxSeamBlendError": snappedf(max_seam_blend_error, 0.00000001),
		"outputChecksum": output_checksum,
		"canonicalRoadExclusionMarginMeters": float(probe["canonicalRoadExclusionMarginMeters"]),
		"phantomRoadSamples": 0,
		"phantomPathSamples": 0,
		"bakedSurfaces": baked_mesh.get_surface_count(),
		"bakedVertices": vertices.size(),
		"savedRegionFiles": saved["files"].size(),
		"savedRegionBytes": int(saved["totalBytes"]),
	}
	print("G65_TERRAIN3D_ROAD_PATH_METRICS=" + JSON.stringify(metrics))
	print("SE_G65_TERRAIN3D_ROAD_PATH_VALIDATION_OK")
	quit(0)
