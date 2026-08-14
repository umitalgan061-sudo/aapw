extends SceneTree

const SOURCE_PATH := "res://.terrain3d-proof/g01-runtime-source.json"
const BAKE_PATH := "res://.terrain3d-proof/g01-runtime-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g01-runtime-bake-topdown.png"
const EXPECTED_SCHEMA := "westeros-g01-terrain3d-source-v1"
const EXPECTED_POLICY := "buzul-muhafizi-g01-terrain3d-threejs-runtime-parity-2026-08-14-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const HEIGHT_TOLERANCE := 0.012
const UNIT_TOLERANCE := 0.006

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G01 Terrain3D runtime parity proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _max3(a: float, b: float, c: float) -> float:
	return maxf(a, maxf(b, c))

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

func _source_color(source: Dictionary, u: float, v: float) -> Color:
	return Color(
		clampf(_channel_value(source, "tintR", u, v), 0.0, 1.0),
		clampf(_channel_value(source, "tintG", u, v), 0.0, 1.0),
		clampf(_channel_value(source, "tintB", u, v), 0.0, 1.0),
		clampf(_channel_value(source, "roughness", u, v), 0.0, 1.0)
	)

func _build_height_image(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			image.set_pixel(x, z, Color(_channel_value(source, "heights", float(x) / 256.0, float(z) / 256.0), 0.0, 0.0, 1.0))
	return image

func _build_control_image(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var blend_u8 := int(round(clampf(_channel_value(source, "snowWeight", float(x) / 256.0, float(z) / 256.0), 0.0, 1.0) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(0) | Terrain3DUtil.enc_overlay(1) | Terrain3DUtil.enc_blend(blend_u8)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0.0, 0.0, 1.0))
	return image

func _build_color_image(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			image.set_pixel(x, z, _source_color(source, float(x) / 256.0, float(z) / 256.0))
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

func _write_preview(terrain: Terrain3D) -> Error:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var pos := Vector3(float(x), 0.0, float(z))
			var color := terrain.data.get_color(pos)
			var roughness := terrain.data.get_roughness(pos)
			var height := terrain.data.get_height(pos)
			if is_nan(color.r) or is_nan(roughness) or is_nan(height): return ERR_INVALID_DATA
			image.set_pixel(x, z, Color(color.r, color.g, color.b, clampf(roughness, 0.0, 1.0)))
	return image.save_png(PREVIEW_PATH)

func _run() -> void:
	if not _require(FileAccess.file_exists(SOURCE_PATH), "G01 runtime source JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(SOURCE_PATH))
	if not _require(parsed is Dictionary, "source JSON did not decode to Dictionary"): return
	var source: Dictionary = parsed
	if not _require(String(source.get("schema", "")) == EXPECTED_SCHEMA, "unexpected source schema"): return
	if not _require(String(source.get("policyId", "")) == EXPECTED_POLICY, "unexpected runtime parity policy"): return
	if not _require(String(source.get("sourceMapSha256", "")) == EXPECTED_MAP_SHA, "owner-map provenance changed"): return
	if not _require(int(source.get("width", 0)) == SOURCE_SIZE and int(source.get("height", 0)) == SOURCE_SIZE, "source must remain 65x65"): return
	for channel in ["heights", "snowWeight", "tintR", "tintG", "tintB", "roughness", "waterConfidence"]:
		if not _require(source.has(channel) and source[channel] is Array and (source[channel] as Array).size() == SOURCE_SIZE * SOURCE_SIZE, "invalid source channel " + channel): return
	var semantic: Dictionary = source.get("semanticMetrics", {})
	if not _require(int(semantic.get("canonicalWaterCells", 0)) == 88 and int(semantic.get("canonicalLandCells", 0)) == 8, "G01 canonical 88/8 fingerprint changed"): return
	if not _require(float(semantic.get("maxG00SharedSeamTintDelta", 1.0)) <= 0.00001 and float(semantic.get("maxG00SharedSeamRoughnessDelta", 1.0)) <= 0.00001, "G00/G01 seam contract changed"): return

	var terrain := Terrain3D.new()
	terrain.name = "G01Terrain3DRuntimeParityProof"
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	terrain.data.import_images([_build_height_image(source), _build_control_image(source), _build_color_image(source)], Vector3.ZERO, 0.0, 1.0)
	var region_count := terrain.data.get_region_count()
	if not _require(region_count >= 4, "257x257 import did not create four Terrain3D regions"): return

	var heights: Array[float] = []
	var snow_weight: Array[float] = []
	var tint_r: Array[float] = []
	var tint_g: Array[float] = []
	var tint_b: Array[float] = []
	var roughness_values: Array[float] = []
	var max_height_error := 0.0
	var max_snow_error := 0.0
	var max_color_error := 0.0
	var max_roughness_error := 0.0
	var max_canonical_water_snow_weight := 0.0
	var max_canonical_water_tint_delta := 0.0
	var max_canonical_water_roughness_delta := 0.0
	var canonical_water_samples := 0
	var checksum: int = 2166136261
	for sy in SOURCE_SIZE:
		var v := float(sy) / 64.0
		for sx in SOURCE_SIZE:
			var u := float(sx) / 64.0
			var pos := Vector3(float(sx * 4), 0.0, float(sy * 4))
			var actual_height := terrain.data.get_height(pos)
			var actual_snow := terrain.data.get_control_blend(pos)
			var actual_color := terrain.data.get_color(pos)
			var actual_roughness := terrain.data.get_roughness(pos)
			if not _require(not is_nan(actual_height) and not is_nan(actual_snow) and not is_nan(actual_color.r) and not is_nan(actual_roughness), "non-finite Terrain3D aligned bake sample"): return
			if not _require(terrain.data.get_control_base_id(pos) == 0 and terrain.data.get_control_overlay_id(pos) == 1, "Terrain3D Rock/Snow texture IDs drifted"): return
			var expected_height := _channel_value(source, "heights", u, v)
			var expected_snow := _channel_value(source, "snowWeight", u, v)
			var expected_color := _source_color(source, u, v)
			max_height_error = maxf(max_height_error, absf(actual_height - expected_height))
			max_snow_error = maxf(max_snow_error, absf(actual_snow - expected_snow))
			max_color_error = maxf(max_color_error, _max3(absf(actual_color.r - expected_color.r), absf(actual_color.g - expected_color.g), absf(actual_color.b - expected_color.b)))
			max_roughness_error = maxf(max_roughness_error, absf(actual_roughness - expected_color.a))
			if _channel_value(source, "waterConfidence", u, v) >= 0.999999:
				canonical_water_samples += 1
				max_canonical_water_snow_weight = maxf(max_canonical_water_snow_weight, absf(actual_snow))
				max_canonical_water_tint_delta = maxf(max_canonical_water_tint_delta, _max3(absf(actual_color.r - 1.0), absf(actual_color.g - 1.0), absf(actual_color.b - 1.0)))
				max_canonical_water_roughness_delta = maxf(max_canonical_water_roughness_delta, absf(actual_roughness - 0.90))
			heights.push_back(snappedf(actual_height, 0.000001))
			snow_weight.push_back(snappedf(actual_snow, 0.00000001))
			tint_r.push_back(snappedf(actual_color.r, 0.00000001))
			tint_g.push_back(snappedf(actual_color.g, 0.00000001))
			tint_b.push_back(snappedf(actual_color.b, 0.00000001))
			roughness_values.push_back(snappedf(actual_roughness, 0.00000001))
			for value in [actual_snow, actual_color.r, actual_color.g, actual_color.b, actual_roughness]: checksum = _hash_u8(checksum, int(round(clampf(value, 0.0, 1.0) * 255.0)))
	if not _require(max_height_error <= HEIGHT_TOLERANCE, "aligned Terrain3D height parity exceeded tolerance"): return
	if not _require(max_snow_error <= UNIT_TOLERANCE, "aligned Terrain3D snow parity exceeded tolerance"): return
	if not _require(max_color_error <= UNIT_TOLERANCE, "aligned Terrain3D tint parity exceeded tolerance"): return
	if not _require(max_roughness_error <= UNIT_TOLERANCE, "aligned Terrain3D roughness parity exceeded tolerance"): return
	if not _require(canonical_water_samples > 0, "aligned bake contains no canonical-water samples"): return
	if not _require(max_canonical_water_snow_weight <= UNIT_TOLERANCE and max_canonical_water_tint_delta <= UNIT_TOLERANCE and max_canonical_water_roughness_delta <= UNIT_TOLERANCE, "canonical water changed during Terrain3D bake"): return

	var boundary_probe_max_height_error := 0.0
	for px in [254.5, 255.0, 255.5, 256.0]:
		for pz in [63.5, 127.5, 191.5, 254.5, 255.5]:
			var actual := terrain.data.get_height(Vector3(float(px), 0.0, float(pz)))
			if not _require(not is_nan(actual), "Terrain3D returned NaN at 255/256 boundary"): return
			boundary_probe_max_height_error = maxf(boundary_probe_max_height_error, absf(actual - _channel_value(source, "heights", float(px) / 256.0, float(pz) / 256.0)))
	if not _require(boundary_probe_max_height_error <= HEIGHT_TOLERANCE, "Terrain3D 255/256 boundary parity exceeded tolerance"): return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "Terrain3D LOD0 bake returned no mesh"): return
	var baked_vertices: PackedVector3Array = baked_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(baked_vertices.size() > 0, "Terrain3D LOD0 bake returned no vertices"): return
	var suffix := OS.get_environment("G01_RUNTIME_PARITY_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var save_dir := "user://g01-terrain3d-runtime-parity-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir))
	terrain.data.save_directory(save_dir)
	var saved := _saved_region_evidence(save_dir)
	if not _require(saved["files"].size() >= 4 and int(saved["totalBytes"]) > 0, "Terrain3D did not persist four regions"): return
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	if not _require(_write_preview(terrain) == OK, "failed to write Terrain3D runtime parity preview"): return

	var bake := {
		"schema":"westeros-g01-terrain3d-bake-v1", "policyId":EXPECTED_POLICY,
		"sourceMapSha256":EXPECTED_MAP_SHA, "terrain3dVersion":String(terrain.version), "lod":0,
		"width":SOURCE_SIZE, "height":SOURCE_SIZE, "regionCount":region_count,
		"savedRegionFiles":saved["files"].size(), "savedRegionBytes":int(saved["totalBytes"]),
		"bakedSurfaces":baked_mesh.get_surface_count(), "bakedVertices":baked_vertices.size(),
		"maxHeightError":snappedf(max_height_error,0.00000001), "maxSnowError":snappedf(max_snow_error,0.00000001),
		"maxColorError":snappedf(max_color_error,0.00000001), "maxRoughnessError":snappedf(max_roughness_error,0.00000001),
		"boundaryProbeMaxHeightError":snappedf(boundary_probe_max_height_error,0.00000001),
		"canonicalWaterCells":int(semantic["canonicalWaterCells"]), "canonicalLandCells":int(semantic["canonicalLandCells"]),
		"maxCanonicalWaterSnowWeight":snappedf(max_canonical_water_snow_weight,0.00000001),
		"maxCanonicalWaterTintDelta":snappedf(max_canonical_water_tint_delta,0.00000001),
		"maxCanonicalWaterRoughnessDelta":snappedf(max_canonical_water_roughness_delta,0.00000001),
		"bakeChecksum":checksum, "heights":heights, "snowWeight":snow_weight,
		"tintR":tint_r, "tintG":tint_g, "tintB":tint_b, "roughness":roughness_values
	}
	var output := FileAccess.open(BAKE_PATH, FileAccess.WRITE)
	if not _require(output != null, "could not open runtime bake JSON output"): return
	output.store_string(JSON.stringify(bake) + "\n")
	output.close()
	print("G01_TERRAIN3D_RUNTIME_BAKE_METRICS=" + JSON.stringify({
		"regionCount":region_count, "savedRegionFiles":saved["files"].size(), "bakedVertices":baked_vertices.size(),
		"maxHeightError":bake["maxHeightError"], "maxSnowError":bake["maxSnowError"],
		"maxColorError":bake["maxColorError"], "maxRoughnessError":bake["maxRoughnessError"],
		"boundaryProbeMaxHeightError":bake["boundaryProbeMaxHeightError"],
		"canonicalWaterSamples":canonical_water_samples, "bakeChecksum":checksum
	}))
	print("NW_G01_TERRAIN3D_RUNTIME_BAKE_OK")
	quit(0)
