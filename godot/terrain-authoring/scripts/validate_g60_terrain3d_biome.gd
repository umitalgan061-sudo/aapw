extends SceneTree

const SOURCE_PATH := "res://.terrain3d-proof/g60-biome-source.json"
const BAKE_PATH := "res://.terrain3d-proof/g60-biome-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g60-biome-topdown.png"
const EXPECTED_SCHEMA := "westeros-g60-terrain3d-biome-source-v1"
const EXPECTED_POLICY := "safak-kartali-g60-terrain3d-biome-2026-08-14-v1"
const EXPECTED_HYDROLOGY_POLICY := "safak-kartali-g60-hydrology-2026-08-12-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const HEIGHT_TOLERANCE := 0.001
const MATERIAL_TOLERANCE := 0.006
const MAX_ALLOWED_SEAFLOOR_HEIGHT := -2.5
const BOUNDARY_AXIS := [0.0, 64.0, 128.0, 192.0, 255.0, 256.0]

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G60 Terrain3D biome proof failed: " + message)
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

func _height_image(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			image.set_pixel(x, z, Color(_channel(source, "heights", float(x) / 256.0, float(z) / 256.0), 0.0, 0.0, 1.0))
	return image

func _color_image(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var u := float(x) / 256.0
			var v := float(z) / 256.0
			image.set_pixel(x, z, Color(_channel(source, "colorR", u, v), _channel(source, "colorG", u, v), _channel(source, "colorB", u, v), _channel(source, "roughness", u, v)))
	return image

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null:
		return {"files": [], "totalBytes": 0}
	var files: Array[String] = []
	var total_bytes := 0
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			var bytes := FileAccess.get_file_as_bytes(directory.path_join(name))
			if bytes.size() > 0:
				files.push_back(name)
				total_bytes += bytes.size()
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
			var c := terrain.data.get_color(pos)
			var roughness := terrain.data.get_roughness(pos)
			if is_nan(c.r) or is_nan(c.g) or is_nan(c.b) or is_nan(roughness):
				return ERR_INVALID_DATA
			image.set_pixel(x, z, Color(c.r, c.g, c.b, clampf(roughness, 0.0, 1.0)))
	return image.save_png(PREVIEW_PATH)

func _run() -> void:
	if not _require(FileAccess.file_exists(SOURCE_PATH), "source JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(SOURCE_PATH))
	if not _require(parsed is Dictionary, "source JSON invalid"): return
	var source: Dictionary = parsed
	if not _require(String(source.get("schema", "")) == EXPECTED_SCHEMA, "schema drifted"): return
	if not _require(String(source.get("policyId", "")) == EXPECTED_POLICY, "policy drifted"): return
	if not _require(String(source.get("hydrologyPolicyId", "")) == EXPECTED_HYDROLOGY_POLICY, "hydrology provenance drifted"): return
	if not _require(String(source.get("sourceMapSha256", "")) == EXPECTED_MAP_SHA, "map.png provenance drifted"): return
	if not _require(String(source.get("geoCell", "")) == "G60", "GeoCell drifted"): return
	if not _require(int(source.get("width", 0)) == SOURCE_SIZE and int(source.get("height", 0)) == SOURCE_SIZE, "source must remain 65x65"): return
	if not _require(int(source.get("terrain3dImportSize", 0)) == IMPORT_SIZE, "Terrain3D import must remain 257x257"): return
	if not _require(int(source.get("terrain3dRegionSize", 0)) == REGION_SIZE, "Terrain3D region must remain 256"): return
	for name in ["heights", "waterConfidence", "colorR", "colorG", "colorB", "roughness"]:
		if not _require(source.has(name) and source[name] is Array and (source[name] as Array).size() == SOURCE_SIZE * SOURCE_SIZE, "invalid channel " + name): return

	for value in source["heights"]:
		var height := float(value)
		if not _require(not is_nan(height) and not is_inf(height) and height <= MAX_ALLOWED_SEAFLOOR_HEIGHT, "source height escaped canonical open-sea depth"): return
	for value in source["waterConfidence"]:
		var confidence := float(value)
		if not _require(not is_nan(confidence) and not is_inf(confidence) and absf(confidence - 1.0) <= 0.00000001, "source water confidence is not unambiguous open sea"): return
	for name in ["colorR", "colorG", "colorB", "roughness"]:
		for value in source[name]:
			var component := float(value)
			if not _require(not is_nan(component) and not is_inf(component) and component >= 0.0 and component <= 1.0, "source material channel escaped [0,1]: " + name): return

	var terrain := Terrain3D.new()
	terrain.name = "G60Terrain3DBiomeProof"
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	terrain.data.import_images([_height_image(source), null, _color_image(source)], Vector3.ZERO, 0.0, 1.0)
	var region_count := terrain.data.get_region_count()
	if not _require(region_count >= 4, "257x257 import did not create >=4 regions"): return

	var max_height_error := 0.0
	var max_color_error := 0.0
	var max_roughness_error := 0.0
	var height_checksum: int = 2166136261
	var color_checksum: int = 2166136261
	var roughness_checksum: int = 2166136261
	var aligned_samples := 0
	for sy in SOURCE_SIZE:
		for sx in SOURCE_SIZE:
			var u := float(sx) / 64.0
			var v := float(sy) / 64.0
			var pos := Vector3(float(sx * 4), 0.0, float(sy * 4))
			var actual_height := terrain.data.get_height(pos)
			var actual_color := terrain.data.get_color(pos)
			var actual_roughness := terrain.data.get_roughness(pos)
			if not _require(not is_nan(actual_height) and not is_inf(actual_height) and actual_height <= MAX_ALLOWED_SEAFLOOR_HEIGHT, "imported seafloor escaped canonical water depth"): return
			if not _require(not is_nan(actual_color.r) and not is_nan(actual_color.g) and not is_nan(actual_color.b), "imported color returned NAN"): return
			if not _require(not is_nan(actual_roughness) and not is_inf(actual_roughness), "imported roughness returned invalid value"): return
			max_height_error = maxf(max_height_error, absf(actual_height - _channel(source, "heights", u, v)))
			max_color_error = maxf(max_color_error, maxf(absf(actual_color.r - _channel(source, "colorR", u, v)), maxf(absf(actual_color.g - _channel(source, "colorG", u, v)), absf(actual_color.b - _channel(source, "colorB", u, v)))))
			max_roughness_error = maxf(max_roughness_error, absf(actual_roughness - _channel(source, "roughness", u, v)))
			height_checksum = _hash_u8(height_checksum, int(round((actual_height + 64.0) * 2.0)))
			for component in [actual_color.r, actual_color.g, actual_color.b]:
				color_checksum = _hash_unit(color_checksum, component)
			roughness_checksum = _hash_unit(roughness_checksum, actual_roughness)
			aligned_samples += 1
	if not _require(aligned_samples == SOURCE_SIZE * SOURCE_SIZE, "aligned round-trip sample count drifted"): return
	if not _require(max_height_error <= HEIGHT_TOLERANCE, "height round-trip exceeded tolerance"): return
	if not _require(max_color_error <= MATERIAL_TOLERANCE, "color round-trip exceeded tolerance"): return
	if not _require(max_roughness_error <= MATERIAL_TOLERANCE, "roughness round-trip exceeded tolerance"): return

	var max_region_height_delta := 0.0
	var max_region_color_delta := 0.0
	var max_region_roughness_delta := 0.0
	var boundary_probe_pairs := 0
	for z in BOUNDARY_AXIS:
		var west := Vector3(255.0, 0.0, float(z))
		var east := Vector3(256.0, 0.0, float(z))
		var west_height := terrain.data.get_height(west)
		var east_height := terrain.data.get_height(east)
		var west_color := terrain.data.get_color(west)
		var east_color := terrain.data.get_color(east)
		var west_roughness := terrain.data.get_roughness(west)
		var east_roughness := terrain.data.get_roughness(east)
		if not _require(not is_nan(west_height) and not is_nan(east_height), "Terrain3D returned NAN at west/east 255/256 height boundary"): return
		if not _require(not is_nan(west_color.r) and not is_nan(east_color.r), "Terrain3D returned NAN at west/east 255/256 color boundary"): return
		if not _require(not is_nan(west_roughness) and not is_nan(east_roughness), "Terrain3D returned NAN at west/east 255/256 roughness boundary"): return
		max_region_height_delta = maxf(max_region_height_delta, absf(west_height - east_height))
		max_region_color_delta = maxf(max_region_color_delta, maxf(absf(west_color.r - east_color.r), maxf(absf(west_color.g - east_color.g), absf(west_color.b - east_color.b))))
		max_region_roughness_delta = maxf(max_region_roughness_delta, absf(west_roughness - east_roughness))
		boundary_probe_pairs += 1
	for x in BOUNDARY_AXIS:
		var north := Vector3(float(x), 0.0, 255.0)
		var south := Vector3(float(x), 0.0, 256.0)
		var north_height := terrain.data.get_height(north)
		var south_height := terrain.data.get_height(south)
		var north_color := terrain.data.get_color(north)
		var south_color := terrain.data.get_color(south)
		var north_roughness := terrain.data.get_roughness(north)
		var south_roughness := terrain.data.get_roughness(south)
		if not _require(not is_nan(north_height) and not is_nan(south_height), "Terrain3D returned NAN at north/south 255/256 height boundary"): return
		if not _require(not is_nan(north_color.r) and not is_nan(south_color.r), "Terrain3D returned NAN at north/south 255/256 color boundary"): return
		if not _require(not is_nan(north_roughness) and not is_nan(south_roughness), "Terrain3D returned NAN at north/south 255/256 roughness boundary"): return
		max_region_height_delta = maxf(max_region_height_delta, absf(north_height - south_height))
		max_region_color_delta = maxf(max_region_color_delta, maxf(absf(north_color.r - south_color.r), maxf(absf(north_color.g - south_color.g), absf(north_color.b - south_color.b))))
		max_region_roughness_delta = maxf(max_region_roughness_delta, absf(north_roughness - south_roughness))
		boundary_probe_pairs += 1
	if not _require(boundary_probe_pairs == 12, "255/256 boundary probe matrix drifted"): return
	if not _require(max_region_height_delta <= HEIGHT_TOLERANCE, "255/256 height seam detected"): return
	if not _require(max_region_color_delta <= MATERIAL_TOLERANCE, "255/256 color seam detected"): return
	if not _require(max_region_roughness_delta <= MATERIAL_TOLERANCE, "255/256 roughness seam detected"): return

	var baked: Mesh = terrain.bake_mesh(0)
	if not _require(baked != null and baked.get_surface_count() > 0, "LOD0 bake returned no mesh"): return
	var vertices: PackedVector3Array = baked.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "LOD0 bake returned no vertices"): return
	var suffix := OS.get_environment("G60_BIOME_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var save_dir := "user://g60-terrain3d-biome-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir))
	terrain.data.save_directory(save_dir)
	var saved := _saved_region_evidence(save_dir)
	if not _require(saved["files"].size() >= 4 and int(saved["totalBytes"]) > 0, "Terrain3D persistence did not save >=4 non-empty region resources"): return
	if not _require(_write_topdown(terrain) == OK, "failed to save finite top-down proof"): return

	var metrics := {
		"geoCell": "G60",
		"regionCount": region_count,
		"persistedFiles": saved["files"].size(),
		"persistedBytes": saved["totalBytes"],
		"alignedSamples": aligned_samples,
		"boundaryProbePairs": boundary_probe_pairs,
		"bakedVertices": vertices.size(),
		"heightChecksum": height_checksum,
		"colorChecksum": color_checksum,
		"roughnessChecksum": roughness_checksum,
		"maxHeightError": max_height_error,
		"maxColorError": max_color_error,
		"maxRoughnessError": max_roughness_error,
		"maxRegionHeightDelta": max_region_height_delta,
		"maxRegionColorDelta": max_region_color_delta,
		"maxRegionRoughnessDelta": max_region_roughness_delta,
	}
	var file := FileAccess.open(BAKE_PATH, FileAccess.WRITE)
	if not _require(file != null, "failed to open bake metrics path"): return
	file.store_string(JSON.stringify(metrics) + "\n")
	file.close()
	print("G60_TERRAIN3D_BIOME_BAKE=" + JSON.stringify(metrics))
	print("NE_G60_TERRAIN3D_BIOME_OK")
	quit(0)
