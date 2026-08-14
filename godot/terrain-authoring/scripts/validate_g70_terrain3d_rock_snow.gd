extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g70-rock-snow-probe.json"
const METRICS_PATH := "res://.terrain3d-proof/g70-rock-snow-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g70-rock-snow-imported-topdown.png"
const EXPECTED_POLICY := "safak-kartali-g70-terrain3d-rock-snow-2026-08-14-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const MAX_HEIGHT_ERROR := 0.001
const MAX_BLEND_ERROR := 0.000001

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G70 Terrain3D Rock/Snow proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _source_value(probe: Dictionary, channel: int, u: float, v: float) -> float:
	var rows: Array = probe["rows"]
	var gx := clampf(u, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var gy := clampf(v, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var x0 := int(floor(gx)); var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, SOURCE_SIZE - 1); var y1 := mini(y0 + 1, SOURCE_SIZE - 1)
	var tx := gx - float(x0); var ty := gy - float(y0)
	var a := float(rows[y0][x0][channel]); var b := float(rows[y0][x1][channel])
	var c := float(rows[y1][x0][channel]); var d := float(rows[y1][x1][channel])
	return lerpf(lerpf(a, b, tx), lerpf(c, d, tx), ty)

func _build_height_image(probe: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			image.set_pixel(x, z, Color(_source_value(probe, 3, float(x) / 256.0, float(z) / 256.0), 0, 0, 1))
	return image

func _build_control_image(probe: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	var base_id := int(probe["baseTextureId"])
	var rock_id := int(probe["rockTextureId"])
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var blend := int(round(clampf(_source_value(probe, 4, float(x) / 256.0, float(z) / 256.0), 0, 1) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(base_id) | Terrain3DUtil.enc_overlay(rock_id) | Terrain3DUtil.enc_blend(blend)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0, 0, 1))
	return image

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null:
		_fail("Terrain3D save directory missing")
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

func _write_preview(terrain: Terrain3D) -> bool:
	var preview := Image.create_empty(256, 256, false, Image.FORMAT_RGBA8)
	for z in 256:
		for x in 256:
			var pos := Vector3(float(x), 0, float(z))
			var blend := terrain.data.get_control_blend(pos)
			if is_nan(blend): return false
			# Open sea Rock/Snow has no terrestrial overlay. The proof intentionally
			# stays oceanic instead of painting a grey rock or white snow square.
			var sea := Color(0.11, 0.25, 0.31, 1)
			var leaked_rock := Color(0.45, 0.43, 0.40, 1)
			preview.set_pixel(x, z, sea.lerp(leaked_rock, clampf(blend, 0, 1)))
	var absolute := ProjectSettings.globalize_path(PREVIEW_PATH)
	DirAccess.make_dir_recursive_absolute(absolute.get_base_dir())
	return preview.save_png(PREVIEW_PATH) == OK

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe did not decode to Dictionary"): return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected policy"): return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "owner-map SHA changed"): return
	if not _require(int(probe["sourceGridSize"]) == SOURCE_SIZE, "source must remain 65x65"): return
	if not _require(int(probe["terrain3dImportSize"]) == IMPORT_SIZE and int(probe["terrain3dRegionSize"]) == REGION_SIZE, "expected 257 import over region_size 256"): return

	for row in probe["rows"]:
		for sample in row:
			if not _require(absf(float(sample[0])) <= 0.00000001, "source invented rock over sea"): return
			if not _require(absf(float(sample[1])) <= 0.00000001, "source invented snow over sea"): return
			if not _require(absf(float(sample[2])) <= 0.00000001, "source invented terrestrial mass over sea"): return
			if not _require(absf(float(sample[4])) <= 0.00000001, "source control blend is non-zero"): return
			if not _require(float(sample[3]) < 0.0, "source seafloor escaped below-water contract"): return

	var terrain := Terrain3D.new()
	terrain.name = "G70Terrain3DRockSnowProof"
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	terrain.data.import_images([_build_height_image(probe), _build_control_image(probe), null], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 4, "257x257 Height+Control import must create at least four regions"): return

	var base_id := int(probe["baseTextureId"]); var rock_id := int(probe["rockTextureId"])
	var max_height_error := 0.0; var max_blend_error := 0.0; var max_actual_blend := 0.0
	var aligned_samples := 0; var output_checksum: int = 2166136261
	for sy in SOURCE_SIZE:
		for sx in SOURCE_SIZE:
			var pos := Vector3(float(sx * 4), 0, float(sy * 4))
			var u := float(sx) / 64.0; var v := float(sy) / 64.0
			var actual_height := terrain.data.get_height(pos)
			if not _require(not is_nan(actual_height), "Terrain3D height NaN"): return
			max_height_error = maxf(max_height_error, absf(actual_height - _source_value(probe, 3, u, v)))
			if not _require(terrain.data.get_control_base_id(pos) == base_id, "base control ID changed"): return
			if not _require(terrain.data.get_control_overlay_id(pos) == rock_id, "rock control ID changed"): return
			var blend := terrain.data.get_control_blend(pos)
			if not _require(not is_nan(blend), "Terrain3D control blend NaN"): return
			max_actual_blend = maxf(max_actual_blend, absf(blend))
			max_blend_error = maxf(max_blend_error, absf(blend - _source_value(probe, 4, u, v)))
			output_checksum = int((output_checksum ^ int(round(clampf(blend, 0, 1) * 255.0))) * 16777619) & 0xffffffff
			aligned_samples += 1
	if not _require(max_height_error <= MAX_HEIGHT_ERROR, "height roundtrip exceeded tolerance"): return
	if not _require(max_blend_error <= MAX_BLEND_ERROR and max_actual_blend <= MAX_BLEND_ERROR, "terrestrial control leaked into imported sea"): return

	var seam_positions := [254.75, 255.0, 255.25, 255.5, 255.75, 256.0]
	var max_seam_height_error := 0.0; var max_seam_blend := 0.0; var seam_samples := 0
	for edge in seam_positions:
		for cross in [32.25, 96.5, 160.75, 224.5, 256.0]:
			for pos in [Vector3(edge, 0, cross), Vector3(cross, 0, edge)]:
				var actual := terrain.data.get_height(pos)
				if not _require(not is_nan(actual), "height NaN at 255/256 seam"): return
				max_seam_height_error = maxf(max_seam_height_error, absf(actual - _source_value(probe, 3, pos.x / 256.0, pos.z / 256.0)))
				var blend := terrain.data.get_control_blend(pos)
				if not _require(not is_nan(blend), "control NaN at 255/256 seam"): return
				max_seam_blend = maxf(max_seam_blend, absf(blend))
				seam_samples += 1
	if not _require(max_seam_height_error <= MAX_HEIGHT_ERROR, "seam height parity exceeded tolerance"): return
	if not _require(max_seam_blend <= MAX_BLEND_ERROR, "rock/snow control leaked at region seam"): return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "LOD0 bake returned no surface"): return
	var vertices: PackedVector3Array = baked_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "LOD0 bake returned no vertices"): return

	var suffix := OS.get_environment("G70_ROCK_SNOW_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var output_dir := "user://g70-terrain3d-rock-snow-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	terrain.data.save_directory(output_dir)
	var saved := _saved_region_evidence(output_dir)
	if not _require(saved["files"].size() >= 4 and int(saved["totalBytes"]) > 0, "region resources were not persisted"): return
	if not _require(_write_preview(terrain), "failed to write top-down proof"): return

	var metrics := {
		"terrain3dVersion": String(terrain.version), "regionSize": int(terrain.region_size),
		"regionCount": terrain.data.get_region_count(), "alignedSamples": aligned_samples,
		"seamSamples": seam_samples, "maxHeightError": snappedf(max_height_error, 0.00000001),
		"maxBlendError": snappedf(max_blend_error, 0.00000001), "maxActualBlend": snappedf(max_actual_blend, 0.00000001),
		"maxSeamHeightError": snappedf(max_seam_height_error, 0.00000001), "maxSeamBlend": snappedf(max_seam_blend, 0.00000001),
		"outputChecksum": output_checksum, "bakedSurfaces": baked_mesh.get_surface_count(), "bakedVertices": vertices.size(),
		"savedRegionFiles": saved["files"].size(), "savedRegionBytes": int(saved["totalBytes"]), "previewPath": PREVIEW_PATH,
	}
	var absolute_metrics := ProjectSettings.globalize_path(METRICS_PATH)
	DirAccess.make_dir_recursive_absolute(absolute_metrics.get_base_dir())
	var file := FileAccess.open(METRICS_PATH, FileAccess.WRITE); file.store_string(JSON.stringify(metrics) + "\n"); file.close()
	print("G70_TERRAIN3D_ROCK_SNOW_METRICS=" + JSON.stringify(metrics))
	print("NE_G70_TERRAIN3D_ROCK_SNOW_VALIDATION_OK")
	quit(0)
