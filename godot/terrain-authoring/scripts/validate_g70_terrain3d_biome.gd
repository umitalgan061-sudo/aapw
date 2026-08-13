extends SceneTree

const SOURCE_PATH := "res://.terrain3d-proof/g70-biome-source.json"
const BAKE_PATH := "res://.terrain3d-proof/g70-biome-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g70-biome-topdown.png"
const EXPECTED_SCHEMA := "westeros-g70-terrain3d-biome-source-v1"
const EXPECTED_POLICY := "safak-kartali-g70-terrain3d-biome-2026-08-13-v1"
const EXPECTED_HYDROLOGY_POLICY := "safak-kartali-g70-terrain3d-hydrology-2026-08-13-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const HEIGHT_TOLERANCE := 0.001
const COLOR_TOLERANCE := 0.006
const ROUGHNESS_TOLERANCE := 0.006
const MAX_ALLOWED_SEAFLOOR_HEIGHT := -2.5
const MAX_BOUNDARY_COLOR_DELTA := 0.04
const MAX_BOUNDARY_ROUGHNESS_DELTA := 0.04

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G70 Terrain3D biome proof failed: " + message)
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

func _source_color(source: Dictionary, u: float, v: float) -> Color:
	return Color(
		clampf(_channel_value(source, "colorR", u, v), 0.0, 1.0),
		clampf(_channel_value(source, "colorG", u, v), 0.0, 1.0),
		clampf(_channel_value(source, "colorB", u, v), 0.0, 1.0),
		clampf(_channel_value(source, "roughness", u, v), 0.0, 1.0)
	)

func _build_height_image(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var value := _channel_value(source, "heights", float(x) / 256.0, float(z) / 256.0)
			image.set_pixel(x, z, Color(value, 0.0, 0.0, 1.0))
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
		_fail("Terrain3D biome save directory was not created")
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

func _hash_unit(checksum: int, value: float) -> int:
	return _hash_u8(checksum, int(round(clampf(value, 0.0, 1.0) * 255.0)))

func _write_topdown(terrain: Terrain3D) -> Error:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var pos := Vector3(float(x), 0.0, float(z))
			var tint := terrain.data.get_color(pos)
			var roughness := terrain.data.get_roughness(pos)
			if is_nan(tint.r) or is_nan(tint.g) or is_nan(tint.b) or is_nan(roughness):
				return ERR_INVALID_DATA
			image.set_pixel(x, z, Color(tint.r, tint.g, tint.b, clampf(roughness, 0.0, 1.0)))
	return image.save_png(PREVIEW_PATH)

func _run() -> void:
	if not _require(FileAccess.file_exists(SOURCE_PATH), "G70 biome source JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(SOURCE_PATH))
	if not _require(parsed is Dictionary, "source JSON did not decode to Dictionary"): return
	var source: Dictionary = parsed
	if not _require(String(source.get("schema", "")) == EXPECTED_SCHEMA, "unexpected biome source schema"): return
	if not _require(String(source.get("policyId", "")) == EXPECTED_POLICY, "unexpected G70 biome policy"): return
	if not _require(String(source.get("hydrologyPolicyId", "")) == EXPECTED_HYDROLOGY_POLICY, "merged G70 hydrology provenance drifted"): return
	if not _require(String(source.get("sourceMapSha256", "")) == EXPECTED_MAP_SHA, "map.png provenance changed"): return
	if not _require(String(source.get("geoCell", "")) == "G70", "source GeoCell drifted"): return
	if not _require(int(source.get("width", 0)) == SOURCE_SIZE and int(source.get("height", 0)) == SOURCE_SIZE, "source must remain 65x65"): return
	if not _require(int(source.get("terrain3dImportSize", 0)) == IMPORT_SIZE, "proof must retain a 257x257 guard-backed import"): return
	if not _require(int(source.get("terrain3dRegionSize", 0)) == REGION_SIZE, "proof must retain Terrain3D region size 256"): return
	for channel in ["heights", "waterConfidence", "colorR", "colorG", "colorB", "roughness"]:
		if not _require(source.has(channel) and source[channel] is Array and (source[channel] as Array).size() == SOURCE_SIZE * SOURCE_SIZE, "invalid source channel " + channel): return
	for value in source["waterConfidence"]:
		if not _require(absf(float(value) - 1.0) <= 0.00000001, "G70 biome guard-backed source is not unambiguous open sea"): return

	var terrain := Terrain3D.new()
	terrain.name = "G70Terrain3DBiomeProof"
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	terrain.data.import_images([_build_height_image(source), null, _build_color_image(source)], Vector3.ZERO, 0.0, 1.0)
	var region_count := terrain.data.get_region_count()
	if not _require(region_count >= 4, "257x257 guard-backed color import did not create four Terrain3D regions"): return

	var max_height_error := 0.0
	var max_color_error := 0.0
	var max_roughness_error := 0.0
	var color_checksum: int = 2166136261
	var roughness_checksum: int = 2166136261
	var sample_count := 0
	for sy in SOURCE_SIZE:
		var v := float(sy) / 64.0
		for sx in SOURCE_SIZE:
			var u := float(sx) / 64.0
			var pos := Vector3(float(sx * 4), 0.0, float(sy * 4))
			var expected_height := _channel_value(source, "heights", u, v)
			var expected_color := _source_color(source, u, v)
			var actual_height := terrain.data.get_height(pos)
			var actual_color := terrain.data.get_color(pos)
			var actual_roughness := terrain.data.get_roughness(pos)
			if not _require(not is_nan(actual_height), "Terrain3D aligned height returned NAN"): return
			if not _require(not is_nan(actual_color.r) and not is_nan(actual_color.g) and not is_nan(actual_color.b), "Terrain3D aligned color returned NAN"): return
			if not _require(not is_nan(actual_roughness), "Terrain3D aligned roughness returned NAN"): return
			if not _require(actual_height <= MAX_ALLOWED_SEAFLOOR_HEIGHT, "G70 biome import raised the merged seafloor above canonical water depth"): return
			max_height_error = maxf(max_height_error, absf(actual_height - expected_height))
			max_color_error = maxf(max_color_error, maxf(absf(actual_color.r - expected_color.r), maxf(absf(actual_color.g - expected_color.g), absf(actual_color.b - expected_color.b))))
			max_roughness_error = maxf(max_roughness_error, absf(actual_roughness - expected_color.a))
			for component in [actual_color.r, actual_color.g, actual_color.b]: color_checksum = _hash_unit(color_checksum, component)
			roughness_checksum = _hash_unit(roughness_checksum, actual_roughness)
			sample_count += 1
	if not _require(max_height_error <= HEIGHT_TOLERANCE, "Terrain3D biome height round-trip exceeded tolerance"): return
	if not _require(max_color_error <= COLOR_TOLERANCE, "Terrain3D color-map round-trip exceeded tolerance"): return
	if not _require(max_roughness_error <= ROUGHNESS_TOLERANCE, "Terrain3D roughness round-trip exceeded tolerance"): return

	var max_boundary_color_delta := 0.0
	var max_boundary_roughness_delta := 0.0
	var max_boundary_height_delta := 0.0
	for z in [0.0, 64.0, 128.0, 192.0, 255.0, 256.0]:
		var west := Vector3(255.0, 0.0, float(z))
		var east := Vector3(256.0, 0.0, float(z))
		var west_height := terrain.data.get_height(west)
		var east_height := terrain.data.get_height(east)
		var west_color := terrain.data.get_color(west)
		var east_color := terrain.data.get_color(east)
		var west_roughness := terrain.data.get_roughness(west)
		var east_roughness := terrain.data.get_roughness(east)
		if not _require(not is_nan(west_height) and not is_nan(east_height), "Terrain3D returned NAN at 255/256 height boundary"): return
		if not _require(not is_nan(west_color.r) and not is_nan(east_color.r), "Terrain3D returned NAN at 255/256 color boundary"): return
		if not _require(not is_nan(west_roughness) and not is_nan(east_roughness), "Terrain3D returned NAN at 255/256 roughness boundary"): return
		max_boundary_height_delta = maxf(max_boundary_height_delta, absf(west_height - east_height))
		max_boundary_color_delta = maxf(max_boundary_color_delta, maxf(absf(west_color.r - east_color.r), maxf(absf(west_color.g - east_color.g), absf(west_color.b - east_color.b))))
		max_boundary_roughness_delta = maxf(max_boundary_roughness_delta, absf(west_roughness - east_roughness))
	for x in [0.0, 64.0, 128.0, 192.0, 255.0, 256.0]:
		var north := Vector3(float(x), 0.0, 255.0)
		var south := Vector3(float(x), 0.0, 256.0)
		var north_height := terrain.data.get_height(north)
		var south_height := terrain.data.get_height(south)
		var north_color := terrain.data.get_color(north)
		var south_color := terrain.data.get_color(south)
		var north_roughness := terrain.data.get_roughness(north)
		var south_roughness := terrain.data.get_roughness(south)
		if not _require(not is_nan(north_height) and not is_nan(south_height), "Terrain3D returned NAN at 255/256 south height boundary"): return
		if not _require(not is_nan(north_color.r) and not is_nan(south_color.r), "Terrain3D returned NAN at 255/256 south color boundary"): return
		if not _require(not is_nan(north_roughness) and not is_nan(south_roughness), "Terrain3D returned NAN at 255/256 south roughness boundary"): return
		max_boundary_height_delta = maxf(max_boundary_height_delta, absf(north_height - south_height))
		max_boundary_color_delta = maxf(max_boundary_color_delta, maxf(absf(north_color.r - south_color.r), maxf(absf(north_color.g - south_color.g), absf(north_color.b - south_color.b))))
		max_boundary_roughness_delta = maxf(max_boundary_roughness_delta, absf(north_roughness - south_roughness))
	if not _require(max_boundary_height_delta <= HEIGHT_TOLERANCE, "Terrain3D 255/256 seafloor boundary developed a height seam"): return
	if not _require(max_boundary_color_delta <= MAX_BOUNDARY_COLOR_DELTA, "Terrain3D 255/256 macro albedo boundary developed a visible seam"): return
	if not _require(max_boundary_roughness_delta <= MAX_BOUNDARY_ROUGHNESS_DELTA, "Terrain3D 255/256 roughness boundary developed a visible seam"): return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "Terrain3D LOD0 biome bake returned no mesh"): return
	var baked_vertices: PackedVector3Array = baked_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(baked_vertices.size() > 0, "Terrain3D LOD0 biome bake returned no vertices"): return

	var suffix := OS.get_environment("G70_BIOME_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var save_dir := "user://g70-terrain3d-biome-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir))
	terrain.data.save_directory(save_dir)
	var saved := _saved_region_evidence(save_dir)
	if not _require(saved["files"].size() >= 4 and int(saved["totalBytes"]) > 0, "Terrain3D did not persist four guard-backed biome regions"): return
	if not _require(_write_topdown(terrain) == OK, "failed to write imported color/roughness top-down proof"): return

	var bake := {
		"schema": "westeros-g70-terrain3d-biome-bake-v1",
		"policyId": EXPECTED_POLICY,
		"hydrologyPolicyId": EXPECTED_HYDROLOGY_POLICY,
		"sourceMapSha256": EXPECTED_MAP_SHA,
		"terrain3dVersion": String(terrain.version),
		"lod": 0,
		"regionCount": region_count,
		"savedRegionFiles": saved["files"].size(),
		"savedRegionBytes": int(saved["totalBytes"]),
		"sampleCount": sample_count,
		"maxHeightError": snappedf(max_height_error, 0.00000001),
		"maxColorError": snappedf(max_color_error, 0.00000001),
		"maxRoughnessError": snappedf(max_roughness_error, 0.00000001),
		"maxBoundaryHeightDelta": snappedf(max_boundary_height_delta, 0.00000001),
		"maxBoundaryColorDelta": snappedf(max_boundary_color_delta, 0.00000001),
		"maxBoundaryRoughnessDelta": snappedf(max_boundary_roughness_delta, 0.00000001),
		"colorChecksum": color_checksum,
		"roughnessChecksum": roughness_checksum,
		"bakedSurfaces": baked_mesh.get_surface_count(),
		"bakedVertices": baked_vertices.size(),
	}
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	var output := FileAccess.open(BAKE_PATH, FileAccess.WRITE)
	if not _require(output != null, "could not open G70 biome bake JSON output"): return
	output.store_string(JSON.stringify(bake) + "\n")
	output.close()
	print("G70_TERRAIN3D_BIOME_BAKE_METRICS=" + JSON.stringify(bake))
	print("NE_G70_TERRAIN3D_BIOME_VALIDATION_OK")
	quit(0)
