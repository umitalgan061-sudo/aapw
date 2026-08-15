extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g60-near-detail-probe.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g60-near-detail-imported-topdown.png"
const BAKE_PATH := "res://.terrain3d-proof/g60-near-detail-bake.json"
const EXPECTED_POLICY := "safak-kartali-g60-terrain3d-near-detail-2026-08-15-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_HEIGHT_ERROR := 0.015
const MAX_BLEND_ERROR := 0.006
const MAX_COLOR_ERROR := 0.006
const MAX_ROUGHNESS_ERROR := 0.006
const MAX_SEAM_HEIGHT_ERROR := 0.025
const MAX_SEAM_MATERIAL_ERROR := 0.008

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G60 Terrain3D Near Detail proof failed: " + message)
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
	var x0 := int(floor(gx)); var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, size - 1); var y1 := mini(y0 + 1, size - 1)
	var tx := gx - float(x0); var ty := gy - float(y0)
	var a := float(rows[y0][x0][channel]); var b := float(rows[y0][x1][channel])
	var c := float(rows[y1][x0][channel]); var d := float(rows[y1][x1][channel])
	return lerpf(lerpf(a, b, tx), lerpf(c, d, tx), ty)

func _source_color(probe: Dictionary, u: float, v: float) -> Color:
	return Color(
		clampf(_source_value(probe, 2, u, v), 0.0, 1.0),
		clampf(_source_value(probe, 3, u, v), 0.0, 1.0),
		clampf(_source_value(probe, 4, u, v), 0.0, 1.0),
		clampf(_source_value(probe, 5, u, v), 0.0, 1.0)
	)

func _build_height_image(probe: Dictionary) -> Image:
	var size := int(probe["terrain3dImportSize"])
	var image := Image.create_empty(size, size, false, Image.FORMAT_RF)
	for z in size:
		for x in size:
			image.set_pixel(x, z, Color(_source_value(probe, 0, float(x) / 256.0, float(z) / 256.0), 0.0, 0.0, 1.0))
	return image

func _build_control_image(probe: Dictionary) -> Image:
	var size := int(probe["terrain3dImportSize"])
	var image := Image.create_empty(size, size, false, Image.FORMAT_RF)
	for z in size:
		for x in size:
			var u := float(x) / 256.0; var v := float(z) / 256.0
			var blend := int(round(clampf(_source_value(probe, 1, u, v), 0.0, 1.0) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(int(probe["baseTextureId"])) | Terrain3DUtil.enc_overlay(int(probe["overlayTextureId"])) | Terrain3DUtil.enc_blend(blend)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0.0, 0.0, 1.0))
	return image

func _build_color_image(probe: Dictionary) -> Image:
	var size := int(probe["terrain3dImportSize"])
	var image := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	for z in size:
		for x in size:
			image.set_pixel(x, z, _source_color(probe, float(x) / 256.0, float(z) / 256.0))
	return image

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null: return {"files": [], "totalBytes": 0}
	var files: Array[String] = []; var total_bytes := 0
	dir.list_dir_begin(); var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			files.push_back(name)
			total_bytes += FileAccess.get_file_as_bytes(directory.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end(); files.sort()
	return {"files": files, "totalBytes": total_bytes}

func _write_preview(terrain: Terrain3D) -> bool:
	var preview := Image.create_empty(257, 257, false, Image.FORMAT_RGBA8)
	for z in 257:
		for x in 257:
			var pos := Vector3(float(x), 0.0, float(z))
			var tint := terrain.data.get_color(pos)
			preview.set_pixel(x, z, Color(tint.r, tint.g, tint.b, clampf(terrain.data.get_roughness(pos), 0.0, 1.0)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	return preview.save_png(PREVIEW_PATH) == OK

func _write_metrics(metrics: Dictionary) -> bool:
	var file := FileAccess.open(BAKE_PATH, FileAccess.WRITE)
	if file == null: return false
	file.store_string(JSON.stringify(metrics) + "\n")
	file.close()
	return true

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "Near Detail probe missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON did not decode to Dictionary"): return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected Near Detail policy"): return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "map provenance changed"): return
	if not _require(int(probe["canonicalWaterCells"]) == 96 and int(probe["canonicalLandCells"]) == 0, "G60 must remain 96/96 sea"): return
	if not _require(float(probe["maxHeightDelta"]) == 0.0 and float(probe["maxControlDelta"]) == 0.0 and float(probe["maxRoadPathDelta"]) == 0.0, "Near Detail changed prior layers"): return
	if not _require(float(probe["maxFoliageDensity"]) == 0.0 and float(probe["maxMacroColorDelta"]) == 0.0, "Near Detail changed macro provenance or foliage"): return
	if not _require(int(probe["sourceGridSize"]) == 129 and int(probe["terrain3dImportSize"]) == 257 and int(probe["terrain3dRegionSize"]) == 256, "proof dimensions changed"): return

	var terrain := Terrain3D.new()
	terrain.name = "G60Terrain3DNearDetailProof"
	get_root().add_child(terrain)
	terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	terrain.data.import_images([_build_height_image(probe), _build_control_image(probe), _build_color_image(probe)], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 4, "257x257 import must span >=4 regions"): return

	var max_height_error := 0.0; var max_blend_error := 0.0; var max_color_error := 0.0; var max_roughness_error := 0.0; var aligned_samples := 0
	for sy in 65:
		for sx in 65:
			var u := float(sx) / 64.0; var v := float(sy) / 64.0; var pos := Vector3(float(sx * 4), 0.0, float(sy * 4))
			var expected_color := _source_color(probe, u, v)
			var actual_height := terrain.data.get_height(pos); var actual_blend := terrain.data.get_control_blend(pos)
			var actual_color := terrain.data.get_color(pos); var actual_roughness := terrain.data.get_roughness(pos)
			if not _require(not is_nan(actual_height) and not is_nan(actual_blend) and not is_nan(actual_color.r) and not is_nan(actual_roughness), "Terrain3D returned NaN"): return
			if not _require(terrain.data.get_control_base_id(pos) == int(probe["baseTextureId"]) and terrain.data.get_control_overlay_id(pos) == int(probe["overlayTextureId"]), "control IDs changed"): return
			max_height_error = maxf(max_height_error, absf(actual_height - _source_value(probe, 0, u, v)))
			max_blend_error = maxf(max_blend_error, absf(actual_blend - _source_value(probe, 1, u, v)))
			max_color_error = maxf(max_color_error, maxf(absf(actual_color.r - expected_color.r), maxf(absf(actual_color.g - expected_color.g), absf(actual_color.b - expected_color.b))))
			max_roughness_error = maxf(max_roughness_error, absf(actual_roughness - expected_color.a))
			aligned_samples += 1
	if not _require(max_height_error <= MAX_HEIGHT_ERROR and max_blend_error <= MAX_BLEND_ERROR, "height/control roundtrip exceeded tolerance"): return
	if not _require(max_color_error <= MAX_COLOR_ERROR and max_roughness_error <= MAX_ROUGHNESS_ERROR, "color/roughness roundtrip exceeded tolerance"): return

	var max_seam_height_error := 0.0; var max_seam_material_error := 0.0; var seam_samples := 0
	for seam in [255.0, 256.0]:
		for cross in [0.0, 64.0, 128.0, 192.0, 255.0, 256.0]:
			for pos in [Vector3(seam, 0.0, cross), Vector3(cross, 0.0, seam)]:
				var u: float = pos.x / 256.0; var v: float = pos.z / 256.0; var expected_color := _source_color(probe, u, v)
				var actual_color := terrain.data.get_color(pos)
				max_seam_height_error = maxf(max_seam_height_error, absf(terrain.data.get_height(pos) - _source_value(probe, 0, u, v)))
				max_seam_material_error = maxf(max_seam_material_error, absf(terrain.data.get_control_blend(pos) - _source_value(probe, 1, u, v)))
				max_seam_material_error = maxf(max_seam_material_error, absf(actual_color.r - expected_color.r))
				max_seam_material_error = maxf(max_seam_material_error, absf(actual_color.g - expected_color.g))
				max_seam_material_error = maxf(max_seam_material_error, absf(actual_color.b - expected_color.b))
				max_seam_material_error = maxf(max_seam_material_error, absf(terrain.data.get_roughness(pos) - expected_color.a))
				seam_samples += 1
	if not _require(max_seam_height_error <= MAX_SEAM_HEIGHT_ERROR and max_seam_material_error <= MAX_SEAM_MATERIAL_ERROR, "255/256 seam exceeded tolerance"): return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "LOD0 bake returned no mesh"): return
	var vertices: PackedVector3Array = baked_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "LOD0 bake returned no vertices"): return
	var suffix := OS.get_environment("G60_NEAR_DETAIL_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var output_dir := "user://g60-terrain3d-near-detail-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	terrain.data.save_directory(output_dir)
	var saved := _saved_region_evidence(output_dir)
	if not _require(saved["files"].size() >= 4 and int(saved["totalBytes"]) > 0, "Terrain3D regions were not persisted"): return
	if not _require(_write_preview(terrain), "failed to write imported top-down evidence"): return

	var metrics := {
		"terrain3dVersion": String(terrain.version), "regionCount": terrain.data.get_region_count(),
		"alignedSamples": aligned_samples, "seamSamples": seam_samples,
		"maxHeightError": max_height_error, "maxBlendError": max_blend_error,
		"maxColorError": max_color_error, "maxRoughnessError": max_roughness_error,
		"maxSeamHeightError": max_seam_height_error, "maxSeamMaterialError": max_seam_material_error,
		"bakedSurfaces": baked_mesh.get_surface_count(), "bakedVertices": vertices.size(),
		"savedRegionFiles": saved["files"].size(), "savedRegionBytes": int(saved["totalBytes"])
	}
	if not _require(_write_metrics(metrics), "failed to write bake metrics"): return
	print("G60_TERRAIN3D_NEAR_DETAIL_METRICS=" + JSON.stringify(metrics))
	print("NE_G60_TERRAIN3D_NEAR_DETAIL_VALIDATION_OK")
	quit(0)
