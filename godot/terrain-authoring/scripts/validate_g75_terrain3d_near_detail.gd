extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g75-near-detail-probe.json"
const EXPECTED_POLICY := "kizil-ufuk-g75-terrain3d-near-detail-2026-08-13-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_HEIGHT_ERROR := 0.006
const MAX_BLEND_ERROR := 0.006
const MAX_COLOR_ERROR := 0.006
const MAX_ROUGHNESS_ERROR := 0.006

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G75 Terrain3D near-detail proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _max3(a: float, b: float, c: float) -> float:
	return maxf(a, maxf(b, c))

func _source_value(probe: Dictionary, u: float, v: float, column: int) -> float:
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
	var a: Array = rows[y0][x0]
	var b: Array = rows[y0][x1]
	var c: Array = rows[y1][x0]
	var d: Array = rows[y1][x1]
	var top := lerpf(float(a[column]), float(b[column]), tx)
	var bottom := lerpf(float(c[column]), float(d[column]), tx)
	return lerpf(top, bottom, ty)

func _source_height(probe: Dictionary, u: float, v: float) -> float:
	return _source_value(probe, u, v, 4)

func _source_blend(probe: Dictionary, u: float, v: float) -> float:
	return clampf(_source_value(probe, u, v, 3), 0.0, 1.0)

func _source_color(probe: Dictionary, u: float, v: float) -> Color:
	return Color(
		clampf(_source_value(probe, u, v, 7), 0.0, 1.0),
		clampf(_source_value(probe, u, v, 8), 0.0, 1.0),
		clampf(_source_value(probe, u, v, 9), 0.0, 1.0),
		clampf(_source_value(probe, u, v, 10), 0.0, 1.0)
	)

func _validate_preserved_source(probe: Dictionary) -> bool:
	var rows: Array = probe["rows"]
	var source_samples := 0
	for row_variant in rows:
		var row: Array = row_variant
		for sample_variant in row:
			var sample: Array = sample_variant
			source_samples += 1
			if not _require(absf(float(sample[5])) <= 0.00000001, "phantom road coverage in near-detail probe"): return false
			if not _require(absf(float(sample[6])) <= 0.00000001, "phantom path coverage in near-detail probe"): return false
			if not _require(float(sample[7]) >= 0.90 and float(sample[7]) <= 1.0, "near-detail tint R out of bounded range"): return false
			if not _require(float(sample[8]) >= 0.90 and float(sample[8]) <= 1.0, "near-detail tint G out of bounded range"): return false
			if not _require(float(sample[9]) >= 0.90 and float(sample[9]) <= 1.0, "near-detail tint B out of bounded range"): return false
			if not _require(float(sample[10]) >= 0.68 and float(sample[10]) <= 0.94, "near-detail roughness out of bounded range"): return false
	return _require(source_samples == 16641, "expected 129x129 near-detail source samples")

func _build_height_image(probe: Dictionary) -> Image:
	var region_size := int(probe["terrain3dRegionSize"])
	var image := Image.create_empty(region_size, region_size, false, Image.FORMAT_RF)
	for z in region_size:
		var v := float(z) / float(region_size - 1)
		for x in region_size:
			var u := float(x) / float(region_size - 1)
			image.set_pixel(x, z, Color(_source_height(probe, u, v), 0.0, 0.0, 1.0))
	return image

func _build_control_image(probe: Dictionary) -> Image:
	var region_size := int(probe["terrain3dRegionSize"])
	var ground_id := int(probe["groundTextureId"])
	var rock_id := int(probe["rockTextureId"])
	var image := Image.create_empty(region_size, region_size, false, Image.FORMAT_RF)
	for z in region_size:
		var v := float(z) / float(region_size - 1)
		for x in region_size:
			var u := float(x) / float(region_size - 1)
			var blend_u8 := int(round(_source_blend(probe, u, v) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(ground_id) | Terrain3DUtil.enc_overlay(rock_id) | Terrain3DUtil.enc_blend(blend_u8)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0.0, 0.0, 1.0))
	return image

func _build_color_image(probe: Dictionary) -> Image:
	var region_size := int(probe["terrain3dRegionSize"])
	var image := Image.create_empty(region_size, region_size, false, Image.FORMAT_RGBA8)
	for z in region_size:
		var v := float(z) / float(region_size - 1)
		for x in region_size:
			var u := float(x) / float(region_size - 1)
			image.set_pixel(x, z, _source_color(probe, u, v))
	return image

func _write_imported_preview(terrain: Terrain3D, probe: Dictionary) -> Error:
	var region_size := int(probe["terrain3dRegionSize"])
	var image := Image.create_empty(region_size, region_size, false, Image.FORMAT_RGBA8)
	for z in region_size:
		for x in region_size:
			var pos := Vector3(float(x), 0.0, float(z))
			var tint := terrain.data.get_color(pos)
			var roughness := terrain.data.get_roughness(pos)
			if is_nan(tint.r) or is_nan(roughness):
				tint = Color(1.0, 0.0, 1.0, 1.0)
				roughness = 1.0
			image.set_pixel(x, z, Color(tint.r, tint.g, tint.b, clampf(roughness, 0.0, 1.0)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	return image.save_png("res://.terrain3d-proof/g75-near-detail-imported-topdown.png")

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

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "G75 near-detail probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON did not decode to Dictionary"): return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected G75 near-detail policy"): return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "owner-map SHA changed"): return
	if not _require(int(probe["sourceGridSize"]) == 129, "proof must use 129x129 source field"): return
	if not _require(int(probe["terrain3dRegionSize"]) == 256, "proof must use Terrain3D region size 256"): return
	if not _validate_preserved_source(probe): return

	var ground_id := int(probe["groundTextureId"])
	var rock_id := int(probe["rockTextureId"])
	var road_id := int(probe["roadTextureId"])
	var path_id := int(probe["pathTextureId"])
	if not _require(ground_id != rock_id and road_id != ground_id and road_id != rock_id, "surface texture slots collapsed"): return
	if not _require(path_id != ground_id and path_id != rock_id and path_id != road_id, "path texture slot collapsed"): return

	var terrain := Terrain3D.new()
	terrain.name = "G75Terrain3DNearDetailProof"
	get_root().add_child(terrain)
	terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return

	var height_image := _build_height_image(probe)
	var control_image := _build_control_image(probe)
	var color_image := _build_color_image(probe)
	terrain.data.import_images([height_image, control_image, color_image], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 1, "Terrain3D import produced no real region"): return

	var sample_positions: Array[int] = []
	for coordinate in range(0, 256, 16): sample_positions.push_back(coordinate)
	if sample_positions[-1] != 255: sample_positions.push_back(255)
	var max_height_error := 0.0
	var max_blend_error := 0.0
	var max_color_error := 0.0
	var max_roughness_error := 0.0
	var control_checksum: int = 2166136261
	var color_checksum: int = 2166136261
	var sample_count := 0
	for z in sample_positions:
		for x in sample_positions:
			var u := float(x) / 255.0
			var v := float(z) / 255.0
			var pos := Vector3(float(x), 0.0, float(z))
			var expected_height := _source_height(probe, u, v)
			var expected_blend := _source_blend(probe, u, v)
			var expected_color := _source_color(probe, u, v)
			var actual_height := terrain.data.get_height(pos)
			if not _require(not is_nan(actual_height), "Terrain3D height returned NAN"): return
			max_height_error = maxf(max_height_error, absf(actual_height - expected_height))
			if not _require(terrain.data.get_control_base_id(pos) == ground_id, "Terrain3D base texture ID changed"): return
			if not _require(terrain.data.get_control_overlay_id(pos) == rock_id, "Terrain3D overlay texture ID changed or near-detail replaced Rock/Snow"): return
			var actual_blend := terrain.data.get_control_blend(pos)
			if not _require(not is_nan(actual_blend), "Terrain3D control blend returned NAN"): return
			max_blend_error = maxf(max_blend_error, absf(actual_blend - expected_blend))
			var actual_color := terrain.data.get_color(pos)
			var actual_roughness := terrain.data.get_roughness(pos)
			if not _require(not is_nan(actual_color.r) and not is_nan(actual_roughness), "Terrain3D color/roughness returned NAN"): return
			max_color_error = maxf(max_color_error, _max3(absf(actual_color.r - expected_color.r), absf(actual_color.g - expected_color.g), absf(actual_color.b - expected_color.b)))
			max_roughness_error = maxf(max_roughness_error, absf(actual_roughness - expected_color.a))
			control_checksum = int((control_checksum ^ int(round(clampf(actual_blend, 0.0, 1.0) * 255.0))) * 16777619) & 0xffffffff
			color_checksum = int((color_checksum ^ int(round(clampf(actual_color.r, 0.0, 1.0) * 255.0))) * 16777619) & 0xffffffff
			color_checksum = int((color_checksum ^ int(round(clampf(actual_color.g, 0.0, 1.0) * 255.0))) * 16777619) & 0xffffffff
			color_checksum = int((color_checksum ^ int(round(clampf(actual_color.b, 0.0, 1.0) * 255.0))) * 16777619) & 0xffffffff
			color_checksum = int((color_checksum ^ int(round(clampf(actual_roughness, 0.0, 1.0) * 255.0))) * 16777619) & 0xffffffff
			sample_count += 1
	if not _require(max_height_error <= MAX_HEIGHT_ERROR, "Terrain3D height preservation exceeded tolerance"): return
	if not _require(max_blend_error <= MAX_BLEND_ERROR, "Terrain3D Rock/Snow blend preservation exceeded tolerance"): return
	if not _require(max_color_error <= MAX_COLOR_ERROR, "Terrain3D near-detail color roundtrip exceeded tolerance"): return
	if not _require(max_roughness_error <= MAX_ROUGHNESS_ERROR, "Terrain3D roughness roundtrip exceeded tolerance"): return
	if not _require(_write_imported_preview(terrain, probe) == OK, "failed to write imported near-detail top-down preview"): return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "Terrain3D LOD0 bake returned no mesh"): return
	var vertices: PackedVector3Array = baked_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "Terrain3D LOD0 bake returned no vertices"): return

	var suffix := OS.get_environment("G75_NEAR_DETAIL_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var output_dir := "user://g75-terrain3d-near-detail-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	terrain.data.save_directory(output_dir)
	var saved := _saved_region_evidence(output_dir)
	if not _require(saved["files"].size() >= 1 and int(saved["totalBytes"]) > 0, "Terrain3D region resource was not persisted"): return

	var metrics := {
		"terrain3dVersion": String(terrain.version),
		"regionSize": int(terrain.region_size),
		"regionCount": terrain.data.get_region_count(),
		"sampleCount": sample_count,
		"maxHeightError": snappedf(max_height_error, 0.00000001),
		"maxBlendError": snappedf(max_blend_error, 0.00000001),
		"maxColorError": snappedf(max_color_error, 0.00000001),
		"maxRoughnessError": snappedf(max_roughness_error, 0.00000001),
		"controlChecksum": control_checksum,
		"colorRoughnessChecksum": color_checksum,
		"bakedSurfaces": baked_mesh.get_surface_count(),
		"bakedVertices": vertices.size(),
		"savedRegionFiles": saved["files"].size(),
		"savedRegionBytes": int(saved["totalBytes"]),
	}
	print("G75_TERRAIN3D_NEAR_DETAIL_METRICS=" + JSON.stringify(metrics))
	print("SE_G75_TERRAIN3D_NEAR_DETAIL_VALIDATION_OK")
	quit(0)
