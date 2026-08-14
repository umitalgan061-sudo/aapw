extends SceneTree

const SOURCE_PATH := "res://.terrain3d-proof/g70-runtime-source.json"
const BAKE_PATH := "res://.terrain3d-proof/g70-runtime-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g70-runtime-bake-topdown.png"
const EXPECTED_SCHEMA := "westeros-g70-terrain3d-source-v1"
const EXPECTED_POLICY := "safak-kartali-g70-terrain3d-threejs-runtime-parity-2026-08-14-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const HEIGHT_TOLERANCE := 0.012
const UNIT_TOLERANCE := 0.006

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G70 Terrain3D runtime parity proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _channel(source: Dictionary, name: String, u: float, v: float) -> float:
	var values: Array = source[name]
	var gx := clampf(u, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var gy := clampf(v, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var x0 := int(floor(gx)); var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, SOURCE_SIZE - 1); var y1 := mini(y0 + 1, SOURCE_SIZE - 1)
	var tx := gx - float(x0); var ty := gy - float(y0)
	var a := float(values[y0 * SOURCE_SIZE + x0]); var b := float(values[y0 * SOURCE_SIZE + x1])
	var c := float(values[y1 * SOURCE_SIZE + x0]); var d := float(values[y1 * SOURCE_SIZE + x1])
	return lerpf(lerpf(a, b, tx), lerpf(c, d, tx), ty)

func _source_color(source: Dictionary, u: float, v: float) -> Color:
	return Color(
		clampf(_channel(source, "tintR", u, v), 0.0, 1.0),
		clampf(_channel(source, "tintG", u, v), 0.0, 1.0),
		clampf(_channel(source, "tintB", u, v), 0.0, 1.0),
		clampf(_channel(source, "roughness", u, v), 0.0, 1.0)
	)

func _build_height(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			image.set_pixel(x, z, Color(_channel(source, "heights", float(x) / 256.0, float(z) / 256.0), 0.0, 0.0, 1.0))
	return image

func _build_control(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var snow := clampf(_channel(source, "snowWeight", float(x) / 256.0, float(z) / 256.0), 0.0, 1.0)
			var bits: int = Terrain3DUtil.enc_base(0) | Terrain3DUtil.enc_overlay(1) | Terrain3DUtil.enc_blend(int(round(snow * 255.0)))
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0.0, 0.0, 1.0))
	return image

func _build_color(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			image.set_pixel(x, z, _source_color(source, float(x) / 256.0, float(z) / 256.0))
	return image

func _saved_regions(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null: return {"files": 0, "bytes": 0}
	var count := 0; var total := 0
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			count += 1
			total += FileAccess.get_file_as_bytes(directory.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end()
	return {"files": count, "bytes": total}

func _hash_u8(checksum: int, value: int) -> int:
	return int((checksum ^ (value & 0xff)) * 16777619) & 0xffffffff

func _write_preview(terrain: Terrain3D) -> Error:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var pos := Vector3(float(x), 0.0, float(z))
			var c := terrain.data.get_color(pos)
			var r := terrain.data.get_roughness(pos)
			if is_nan(c.r) or is_nan(r): return ERR_INVALID_DATA
			image.set_pixel(x, z, Color(c.r, c.g, c.b, clampf(r, 0.0, 1.0)))
	return image.save_png(PREVIEW_PATH)

func _run() -> void:
	if not _require(FileAccess.file_exists(SOURCE_PATH), "G70 runtime source JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(SOURCE_PATH))
	if not _require(parsed is Dictionary, "source JSON did not decode to Dictionary"): return
	var source: Dictionary = parsed
	if not _require(String(source.get("schema", "")) == EXPECTED_SCHEMA, "unexpected source schema"): return
	if not _require(String(source.get("policyId", "")) == EXPECTED_POLICY, "unexpected parity policy"): return
	if not _require(String(source.get("sourceMapSha256", "")) == EXPECTED_MAP_SHA, "map.png provenance changed"): return
	if not _require(int(source.get("width", 0)) == SOURCE_SIZE and int(source.get("height", 0)) == SOURCE_SIZE, "source must remain 65x65"): return
	for channel in ["heights", "snowWeight", "tintR", "tintG", "tintB", "roughness"]:
		if not _require(source.has(channel) and source[channel] is Array and (source[channel] as Array).size() == SOURCE_SIZE * SOURCE_SIZE, "invalid source channel " + channel): return

	var terrain := Terrain3D.new()
	terrain.name = "G70Terrain3DRuntimeParityProof"
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	terrain.data.import_images([_build_height(source), _build_control(source), _build_color(source)], Vector3.ZERO, 0.0, 1.0)
	var region_count := terrain.data.get_region_count()
	if not _require(region_count >= 4, "257x257 import did not create four Terrain3D regions"): return

	var heights: Array[float] = []; var snow_weight: Array[float] = []
	var tint_r: Array[float] = []; var tint_g: Array[float] = []; var tint_b: Array[float] = []; var roughness_values: Array[float] = []
	var max_height_error := 0.0; var max_snow_error := 0.0; var max_color_error := 0.0; var max_roughness_error := 0.0
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
			if not _require(not is_nan(actual_height) and not is_nan(actual_snow) and not is_nan(actual_color.r) and not is_nan(actual_roughness), "non-finite aligned Terrain3D sample"): return
			if not _require(terrain.data.get_control_base_id(pos) == 0 and terrain.data.get_control_overlay_id(pos) == 1, "Terrain3D control texture IDs drifted"): return
			var expected_color := _source_color(source, u, v)
			max_height_error = maxf(max_height_error, absf(actual_height - _channel(source, "heights", u, v)))
			max_snow_error = maxf(max_snow_error, absf(actual_snow - _channel(source, "snowWeight", u, v)))
			max_color_error = maxf(max_color_error, maxf(absf(actual_color.r - expected_color.r), maxf(absf(actual_color.g - expected_color.g), absf(actual_color.b - expected_color.b))))
			max_roughness_error = maxf(max_roughness_error, absf(actual_roughness - expected_color.a))
			heights.push_back(snappedf(actual_height, 0.000001)); snow_weight.push_back(snappedf(actual_snow, 0.00000001))
			tint_r.push_back(snappedf(actual_color.r, 0.00000001)); tint_g.push_back(snappedf(actual_color.g, 0.00000001)); tint_b.push_back(snappedf(actual_color.b, 0.00000001)); roughness_values.push_back(snappedf(actual_roughness, 0.00000001))
			for value in [actual_snow, actual_color.r, actual_color.g, actual_color.b, actual_roughness]: checksum = _hash_u8(checksum, int(round(clampf(value, 0.0, 1.0) * 255.0)))
	if not _require(max_height_error <= HEIGHT_TOLERANCE, "aligned height parity exceeded tolerance"): return
	if not _require(max_snow_error <= UNIT_TOLERANCE, "aligned snow parity exceeded tolerance"): return
	if not _require(max_color_error <= UNIT_TOLERANCE, "aligned color parity exceeded tolerance"): return
	if not _require(max_roughness_error <= UNIT_TOLERANCE, "aligned roughness parity exceeded tolerance"): return
	if not _require(max_snow_error <= UNIT_TOLERANCE and float((source["semanticMetrics"] as Dictionary).get("maxSnowWeight", 1.0)) <= 0.00000001, "open-sea zero-snow invariant failed"): return

	var boundary_probe_max_height_error := 0.0
	for px in [254.5, 255.0, 255.5, 256.0]:
		for pz in [31.5, 95.5, 159.5, 223.5, 255.5]:
			var actual := terrain.data.get_height(Vector3(float(px), 0.0, float(pz)))
			if not _require(not is_nan(actual), "Terrain3D returned NAN at 255/256 boundary"): return
			boundary_probe_max_height_error = maxf(boundary_probe_max_height_error, absf(actual - _channel(source, "heights", float(px) / 256.0, float(pz) / 256.0)))
	if not _require(boundary_probe_max_height_error <= HEIGHT_TOLERANCE, "255/256 guard-boundary parity exceeded tolerance"): return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "Terrain3D LOD0 bake returned no mesh"): return
	var baked_vertices: PackedVector3Array = baked_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(baked_vertices.size() > 0, "Terrain3D LOD0 bake returned no vertices"): return
	var suffix := OS.get_environment("G70_RUNTIME_PARITY_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var save_dir := "user://g70-terrain3d-runtime-parity-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir))
	terrain.data.save_directory(save_dir)
	var saved := _saved_regions(save_dir)
	if not _require(int(saved["files"]) >= 4 and int(saved["bytes"]) > 0, "Terrain3D did not persist four regions"): return
	if not _require(_write_preview(terrain) == OK, "failed to write Terrain3D parity preview"): return

	var bake := {
		"schema":"westeros-g70-terrain3d-bake-v1", "policyId":EXPECTED_POLICY, "sourceMapSha256":EXPECTED_MAP_SHA,
		"terrain3dVersion":String(terrain.version), "lod":0, "width":SOURCE_SIZE, "height":SOURCE_SIZE,
		"regionCount":region_count, "savedRegionFiles":int(saved["files"]), "savedRegionBytes":int(saved["bytes"]),
		"bakedSurfaces":baked_mesh.get_surface_count(), "bakedVertices":baked_vertices.size(),
		"maxHeightError":snappedf(max_height_error,0.00000001), "maxSnowError":snappedf(max_snow_error,0.00000001),
		"maxColorError":snappedf(max_color_error,0.00000001), "maxRoughnessError":snappedf(max_roughness_error,0.00000001),
		"boundaryProbeMaxHeightError":snappedf(boundary_probe_max_height_error,0.00000001), "bakeChecksum":checksum,
		"heights":heights, "snowWeight":snow_weight, "tintR":tint_r, "tintG":tint_g, "tintB":tint_b, "roughness":roughness_values
	}
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	var output := FileAccess.open(BAKE_PATH, FileAccess.WRITE)
	if not _require(output != null, "could not open runtime bake JSON output"): return
	output.store_string(JSON.stringify(bake) + "\n"); output.close()
	print("G70_TERRAIN3D_RUNTIME_BAKE_METRICS=" + JSON.stringify({"regionCount":region_count,"savedRegionFiles":saved["files"],"bakedVertices":baked_vertices.size(),"maxHeightError":bake["maxHeightError"],"maxSnowError":bake["maxSnowError"],"maxColorError":bake["maxColorError"],"maxRoughnessError":bake["maxRoughnessError"],"boundaryProbeMaxHeightError":bake["boundaryProbeMaxHeightError"],"bakeChecksum":checksum}))
	print("NE_G70_TERRAIN3D_RUNTIME_BAKE_OK")
	quit(0)
