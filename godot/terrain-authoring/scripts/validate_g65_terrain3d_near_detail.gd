extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g65-near-detail-probe.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g65-near-detail-imported-topdown.png"
const EXPECTED_POLICY := "kizil-ufuk-g65-terrain3d-near-detail-2026-08-13-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_HEIGHT_ERROR := 0.012
const MAX_BLEND_ERROR := 0.006
const MAX_COLOR_ERROR := 0.006
const MAX_ROUGHNESS_ERROR := 0.006
const MAX_SEAM_HEIGHT_ERROR := 0.02
const MAX_SEAM_BLEND_ERROR := 0.006
const MAX_SEAM_COLOR_ERROR := 0.006
const MAX_SEAM_ROUGHNESS_ERROR := 0.006

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G65 Terrain3D Near Detail proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _max3(a: float, b: float, c: float) -> float:
	return maxf(a, maxf(b, c))

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

func _source_color(probe: Dictionary, u: float, v: float) -> Color:
	return Color(
		clampf(_source_value(probe, 7, u, v), 0.0, 1.0),
		clampf(_source_value(probe, 8, u, v), 0.0, 1.0),
		clampf(_source_value(probe, 9, u, v), 0.0, 1.0),
		clampf(_source_value(probe, 10, u, v), 0.0, 1.0)
	)

func _validate_preserved_source(probe: Dictionary) -> bool:
	var source_samples := 0
	var max_snow := 0.0
	for row_variant in probe["rows"]:
		var row: Array = row_variant
		for sample_variant in row:
			var sample: Array = sample_variant
			source_samples += 1
			max_snow = maxf(max_snow, float(sample[2]))
			if not _require(absf(float(sample[5])) <= 0.00000001, "phantom road coverage in Near Detail probe"): return false
			if not _require(absf(float(sample[6])) <= 0.00000001, "phantom path coverage in Near Detail probe"): return false
			if not _require(float(sample[7]) >= 0.90 and float(sample[7]) <= 1.0, "Near Detail tint R out of bounded range"): return false
			if not _require(float(sample[8]) >= 0.90 and float(sample[8]) <= 1.0, "Near Detail tint G out of bounded range"): return false
			if not _require(float(sample[9]) >= 0.90 and float(sample[9]) <= 1.0, "Near Detail tint B out of bounded range"): return false
			if not _require(float(sample[10]) >= 0.62 and float(sample[10]) <= 0.96, "Near Detail roughness out of bounded range"): return false
	if not _require(source_samples == 16641, "expected 129x129 Near Detail source samples"): return false
	return _require(max_snow <= 0.00000001, "Near Detail regressed warm G65 zero-snow contract")

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

func _build_color_image(probe: Dictionary) -> Image:
	var import_size := int(probe["terrain3dImportSize"])
	var image := Image.create_empty(import_size, import_size, false, Image.FORMAT_RGBA8)
	for z in import_size:
		var v := float(z) / float(import_size - 1)
		for x in import_size:
			var u := float(x) / float(import_size - 1)
			image.set_pixel(x, z, _source_color(probe, u, v))
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
			var pos := Vector3(float(x), 0.0, float(z))
			var tint := terrain.data.get_color(pos)
			var roughness := terrain.data.get_roughness(pos)
			if is_nan(tint.r) or is_nan(tint.g) or is_nan(tint.b) or is_nan(roughness): return false
			preview.set_pixel(x, z, Color(tint.r, tint.g, tint.b, clampf(roughness, 0.0, 1.0)))
	var absolute := ProjectSettings.globalize_path(PREVIEW_PATH)
	DirAccess.make_dir_recursive_absolute(absolute.get_base_dir())
	return preview.save_png(PREVIEW_PATH) == OK

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "G65 Near Detail probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON did not decode to Dictionary"): return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected G65 Near Detail policy"): return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "owner-map SHA changed"): return
	if not _require(int(probe["sourceGridSize"]) == 129, "source probe must remain 129x129"): return
	if not _require(int(probe["terrain3dRegionSize"]) == 256 and int(probe["terrain3dImportSize"]) == 257, "proof must preserve 257 import over region size 256"): return
	if not _validate_preserved_source(probe): return

	var ground_id := int(probe["groundTextureId"])
	var rock_id := int(probe["rockTextureId"])
	var road_id := int(probe["roadTextureId"])
	var path_id := int(probe["pathTextureId"])
	if not _require(ground_id != rock_id and road_id != ground_id and road_id != rock_id, "surface texture slots collapsed"): return
	if not _require(path_id != ground_id and path_id != rock_id and path_id != road_id, "path texture slot collapsed"): return

	var terrain := Terrain3D.new()
	terrain.name = "G65Terrain3DNearDetailProof"
	get_root().add_child(terrain)
	terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return

	terrain.data.import_images([_build_height_image(probe), _build_control_image(probe), _build_color_image(probe)], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 4, "257x257 Height+Control+Color import must produce four real regions"): return

	var max_height_error := 0.0
	var max_blend_error := 0.0
	var max_color_error := 0.0
	var max_roughness_error := 0.0
	var output_checksum: int = 2166136261
	var aligned_samples := 0
	for sy in 65:
		for sx in 65:
			var x := sx * 4
			var z := sy * 4
			var u := float(sx) / 64.0
			var v := float(sy) / 64.0
			var pos := Vector3(float(x), 0.0, float(z))
			var expected_height := _source_value(probe, 4, u, v)
			var expected_blend := _source_value(probe, 3, u, v)
			var expected_color := _source_color(probe, u, v)
			var actual_height := terrain.data.get_height(pos)
			if not _require(not is_nan(actual_height), "Terrain3D height returned NaN at aligned Near Detail sample"): return
			max_height_error = maxf(max_height_error, absf(actual_height - expected_height))
			if not _require(terrain.data.get_control_base_id(pos) == ground_id, "Terrain3D base texture ID changed"): return
			if not _require(terrain.data.get_control_overlay_id(pos) == rock_id, "Near Detail replaced preserved Rock/Snow overlay"): return
			var actual_blend := terrain.data.get_control_blend(pos)
			if not _require(not is_nan(actual_blend), "Terrain3D Rock/Snow blend returned NaN"): return
			max_blend_error = maxf(max_blend_error, absf(actual_blend - expected_blend))
			var actual_color := terrain.data.get_color(pos)
			var actual_roughness := terrain.data.get_roughness(pos)
			if not _require(not is_nan(actual_color.r) and not is_nan(actual_color.g) and not is_nan(actual_color.b) and not is_nan(actual_roughness), "Terrain3D color/roughness returned NaN"): return
			max_color_error = maxf(max_color_error, _max3(absf(actual_color.r - expected_color.r), absf(actual_color.g - expected_color.g), absf(actual_color.b - expected_color.b)))
			max_roughness_error = maxf(max_roughness_error, absf(actual_roughness - expected_color.a))
			for value in [actual_blend, actual_color.r, actual_color.g, actual_color.b, actual_roughness]:
				output_checksum = int((output_checksum ^ int(round(clampf(float(value), 0.0, 1.0) * 255.0))) * 16777619) & 0xffffffff
			aligned_samples += 1
	if not _require(max_height_error <= MAX_HEIGHT_ERROR, "Terrain3D Near Detail preserved height exceeded tolerance"): return
	if not _require(max_blend_error <= MAX_BLEND_ERROR, "Terrain3D Near Detail preserved Rock/Snow blend exceeded tolerance"): return
	if not _require(max_color_error <= MAX_COLOR_ERROR, "Terrain3D Near Detail color roundtrip exceeded tolerance"): return
	if not _require(max_roughness_error <= MAX_ROUGHNESS_ERROR, "Terrain3D Near Detail roughness roundtrip exceeded tolerance"): return

	var seam_positions := [254.75, 255.0, 255.25, 255.5, 255.75, 256.0]
	var max_seam_height_error := 0.0
	var seam_samples := 0
	for z in [64.5, 128.5, 192.5, 255.5]:
		for x in seam_positions:
			var actual := terrain.data.get_height(Vector3(x, 0.0, z))
			if not _require(not is_nan(actual), "Terrain3D height returned NaN across x=255/256 Near Detail seam"): return
			max_seam_height_error = maxf(max_seam_height_error, absf(actual - _source_value(probe, 4, x / 256.0, z / 256.0)))
			seam_samples += 1
	for x in [64.5, 128.5, 192.5, 255.5]:
		for z in seam_positions:
			var actual := terrain.data.get_height(Vector3(x, 0.0, z))
			if not _require(not is_nan(actual), "Terrain3D height returned NaN across z=255/256 Near Detail seam"): return
			max_seam_height_error = maxf(max_seam_height_error, absf(actual - _source_value(probe, 4, x / 256.0, z / 256.0)))
			seam_samples += 1
	if not _require(max_seam_height_error <= MAX_SEAM_HEIGHT_ERROR, "Terrain3D Near Detail region-seam height parity exceeded tolerance"): return

	var max_seam_blend_error := 0.0
	var max_seam_color_error := 0.0
	var max_seam_roughness_error := 0.0
	var material_seam_samples := 0
	for seam in [255.0, 256.0]:
		for cross in [64.0, 128.0, 192.0, 255.0, 256.0]:
			for p in [Vector3(seam, 0.0, cross), Vector3(cross, 0.0, seam)]:
				if not _require(terrain.data.get_control_base_id(p) == ground_id and terrain.data.get_control_overlay_id(p) == rock_id, "Terrain3D preserved control IDs changed at Near Detail seam"): return
				var actual_blend := terrain.data.get_control_blend(p)
				var actual_color := terrain.data.get_color(p)
				var actual_roughness := terrain.data.get_roughness(p)
				if not _require(not is_nan(actual_blend) and not is_nan(actual_color.r) and not is_nan(actual_color.g) and not is_nan(actual_color.b) and not is_nan(actual_roughness), "Terrain3D material returned NaN at Near Detail seam"): return
				var expected_blend := _source_value(probe, 3, p.x / 256.0, p.z / 256.0)
				var expected_color := _source_color(probe, p.x / 256.0, p.z / 256.0)
				max_seam_blend_error = maxf(max_seam_blend_error, absf(actual_blend - expected_blend))
				max_seam_color_error = maxf(max_seam_color_error, _max3(absf(actual_color.r - expected_color.r), absf(actual_color.g - expected_color.g), absf(actual_color.b - expected_color.b)))
				max_seam_roughness_error = maxf(max_seam_roughness_error, absf(actual_roughness - expected_color.a))
				material_seam_samples += 1
	if not _require(max_seam_blend_error <= MAX_SEAM_BLEND_ERROR, "Terrain3D Near Detail region-seam control parity exceeded tolerance"): return
	if not _require(max_seam_color_error <= MAX_SEAM_COLOR_ERROR, "Terrain3D Near Detail region-seam color parity exceeded tolerance"): return
	if not _require(max_seam_roughness_error <= MAX_SEAM_ROUGHNESS_ERROR, "Terrain3D Near Detail region-seam roughness parity exceeded tolerance"): return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "Terrain3D LOD0 Near Detail bake returned no mesh"): return
	var vertices: PackedVector3Array = baked_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "Terrain3D LOD0 Near Detail bake returned no vertices"): return

	var suffix := OS.get_environment("G65_NEAR_DETAIL_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var output_dir := "user://g65-terrain3d-near-detail-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	terrain.data.save_directory(output_dir)
	var saved := _saved_region_evidence(output_dir)
	if not _require(saved["files"].size() >= 4 and int(saved["totalBytes"]) > 0, "Terrain3D Near Detail region resources were not persisted"): return
	if not _require(_write_preview(terrain, 257), "failed to write imported Near Detail top-down evidence"): return

	var metrics := {
		"terrain3dVersion": String(terrain.version),
		"regionSize": int(terrain.region_size),
		"regionCount": terrain.data.get_region_count(),
		"alignedSamples": aligned_samples,
		"seamSamples": seam_samples,
		"materialSeamSamples": material_seam_samples,
		"maxHeightError": snappedf(max_height_error, 0.00000001),
		"maxBlendError": snappedf(max_blend_error, 0.00000001),
		"maxColorError": snappedf(max_color_error, 0.00000001),
		"maxRoughnessError": snappedf(max_roughness_error, 0.00000001),
		"maxSeamHeightError": snappedf(max_seam_height_error, 0.00000001),
		"maxSeamBlendError": snappedf(max_seam_blend_error, 0.00000001),
		"maxSeamColorError": snappedf(max_seam_color_error, 0.00000001),
		"maxSeamRoughnessError": snappedf(max_seam_roughness_error, 0.00000001),
		"outputChecksum": output_checksum,
		"phantomRoadSamples": 0,
		"phantomPathSamples": 0,
		"bakedSurfaces": baked_mesh.get_surface_count(),
		"bakedVertices": vertices.size(),
		"savedRegionFiles": saved["files"].size(),
		"savedRegionBytes": int(saved["totalBytes"]),
	}
	print("G65_TERRAIN3D_NEAR_DETAIL_METRICS=" + JSON.stringify(metrics))
	print("SE_G65_TERRAIN3D_NEAR_DETAIL_VALIDATION_OK")
	quit(0)
