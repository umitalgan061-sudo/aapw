extends SceneTree

const SOURCE_PATH := "res://.terrain3d-proof/g00-runtime-source.json"
const BAKE_PATH := "res://.terrain3d-proof/g00-runtime-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g00-runtime-bake-topdown.png"
const EXPECTED_SCHEMA := "westeros-g00-terrain3d-source-v1"
const EXPECTED_POLICY := "buzul-muhafizi-g00-terrain3d-threejs-runtime-parity-2026-08-13-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 257
const REGION_SIZE := 256
const ROAD_ACTIVE_EPS := 0.002
const HEIGHT_TOLERANCE := 0.012
const UNIT_TOLERANCE := 0.006

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G00 Terrain3D runtime parity proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _channel(source: Dictionary, name: String, x: int, z: int) -> float:
	return float((source[name] as Array)[z * SOURCE_SIZE + x])

func _expected_control(source: Dictionary, x: int, z: int) -> Dictionary:
	var road := clampf(_channel(source, "roadCoverage", x, z), 0.0, 1.0)
	var path := clampf(_channel(source, "pathCoverage", x, z), 0.0, 1.0)
	var snow := clampf(_channel(source, "snowSurface", x, z), 0.0, 1.0)
	var rock_id := int(source["rockTextureId"])
	var snow_id := int(source["snowTextureId"])
	if road > ROAD_ACTIVE_EPS:
		return {"base": snow_id if snow >= 0.5 else rock_id, "overlay": int(source["roadTextureId"]), "blend": road, "kind": 1}
	if path > ROAD_ACTIVE_EPS:
		return {"base": snow_id if snow >= 0.5 else rock_id, "overlay": int(source["pathTextureId"]), "blend": path, "kind": 2}
	return {"base": rock_id, "overlay": snow_id, "blend": snow, "kind": 0}

func _source_color(source: Dictionary, x: int, z: int) -> Color:
	return Color(
		clampf(_channel(source, "tintR", x, z), 0.0, 1.0),
		clampf(_channel(source, "tintG", x, z), 0.0, 1.0),
		clampf(_channel(source, "tintB", x, z), 0.0, 1.0),
		clampf(_channel(source, "roughness", x, z), 0.0, 1.0)
	)

func _build_height_image(source: Dictionary) -> Image:
	var image := Image.create_empty(SOURCE_SIZE, SOURCE_SIZE, false, Image.FORMAT_RF)
	for z in SOURCE_SIZE:
		for x in SOURCE_SIZE:
			image.set_pixel(x, z, Color(_channel(source, "heights", x, z), 0.0, 0.0, 1.0))
	return image

func _build_control_image(source: Dictionary) -> Image:
	var image := Image.create_empty(SOURCE_SIZE, SOURCE_SIZE, false, Image.FORMAT_RF)
	for z in SOURCE_SIZE:
		for x in SOURCE_SIZE:
			var expected := _expected_control(source, x, z)
			var blend_u8 := int(round(clampf(float(expected["blend"]), 0.0, 1.0) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(int(expected["base"])) | Terrain3DUtil.enc_overlay(int(expected["overlay"])) | Terrain3DUtil.enc_blend(blend_u8)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0.0, 0.0, 1.0))
	return image

func _build_color_image(source: Dictionary) -> Image:
	var image := Image.create_empty(SOURCE_SIZE, SOURCE_SIZE, false, Image.FORMAT_RGBA8)
	for z in SOURCE_SIZE:
		for x in SOURCE_SIZE:
			image.set_pixel(x, z, _source_color(source, x, z))
	return image

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null:
		_fail("Terrain3D G00 save directory was not created")
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

func _write_preview(terrain: Terrain3D, source: Dictionary) -> Error:
	var image := Image.create_empty(SOURCE_SIZE, SOURCE_SIZE, false, Image.FORMAT_RGBA8)
	for z in SOURCE_SIZE:
		for x in SOURCE_SIZE:
			var pos := Vector3(float(x), 0.0, float(z))
			var color := terrain.data.get_color(pos)
			var roughness := terrain.data.get_roughness(pos)
			var height := terrain.data.get_height(pos)
			if is_nan(color.r) or is_nan(roughness) or is_nan(height):
				return ERR_INVALID_DATA
			var overlay := terrain.data.get_control_overlay_id(pos)
			var blend := terrain.data.get_control_blend(pos)
			if overlay == int(source["roadTextureId"]) and blend > ROAD_ACTIVE_EPS:
				image.set_pixel(x, z, Color(0.42, 0.31, 0.20, 1.0))
			elif overlay == int(source["pathTextureId"]) and blend > ROAD_ACTIVE_EPS:
				image.set_pixel(x, z, Color(0.53, 0.43, 0.29, 1.0))
			else:
				image.set_pixel(x, z, Color(color.r, color.g, color.b, clampf(roughness, 0.0, 1.0)))
	return image.save_png(PREVIEW_PATH)

func _run() -> void:
	if not _require(FileAccess.file_exists(SOURCE_PATH), "G00 runtime source JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(SOURCE_PATH))
	if not _require(parsed is Dictionary, "G00 source JSON did not decode to Dictionary"): return
	var source: Dictionary = parsed
	if not _require(String(source.get("schema", "")) == EXPECTED_SCHEMA, "unexpected G00 runtime source schema"): return
	if not _require(String(source.get("policyId", "")) == EXPECTED_POLICY, "unexpected G00 runtime parity policy"): return
	if not _require(String(source.get("sourceMapSha256", "")) == EXPECTED_MAP_SHA, "G00 owner-map provenance changed"): return
	if not _require(int(source.get("width", 0)) == SOURCE_SIZE and int(source.get("height", 0)) == SOURCE_SIZE, "G00 runtime source must remain 257x257"): return
	for channel in ["heights", "roadCoverage", "pathCoverage", "snowSurface", "tintR", "tintG", "tintB", "roughness"]:
		if not _require(source.has(channel) and source[channel] is Array and (source[channel] as Array).size() == SOURCE_SIZE * SOURCE_SIZE, "invalid G00 source channel " + channel): return

	var rock_id := int(source["rockTextureId"])
	var snow_id := int(source["snowTextureId"])
	var road_id := int(source["roadTextureId"])
	var path_id := int(source["pathTextureId"])
	if not _require(rock_id != snow_id and road_id != path_id and road_id != rock_id and path_id != snow_id, "G00 Terrain3D texture IDs collapsed"): return

	var terrain := Terrain3D.new()
	terrain.name = "G00Terrain3DRuntimeParityProof"
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	terrain.data.import_images([_build_height_image(source), _build_control_image(source), _build_color_image(source)], Vector3.ZERO, 0.0, 1.0)
	var region_count := terrain.data.get_region_count()
	if not _require(region_count >= 4, "257x257 G00 import did not create four Terrain3D regions"): return

	var heights: Array[float] = []
	var road_coverage: Array[float] = []
	var path_coverage: Array[float] = []
	var snow_surface: Array[float] = []
	var tint_r: Array[float] = []
	var tint_g: Array[float] = []
	var tint_b: Array[float] = []
	var roughness_values: Array[float] = []
	var max_height_error := 0.0
	var max_road_error := 0.0
	var max_path_error := 0.0
	var max_snow_error := 0.0
	var max_color_error := 0.0
	var max_roughness_error := 0.0
	var active_road_samples := 0
	var active_path_samples := 0
	var checksum: int = 2166136261
	for z in SOURCE_SIZE:
		for x in SOURCE_SIZE:
			var pos := Vector3(float(x), 0.0, float(z))
			var expected := _expected_control(source, x, z)
			var actual_height := terrain.data.get_height(pos)
			var actual_blend := terrain.data.get_control_blend(pos)
			var actual_base := terrain.data.get_control_base_id(pos)
			var actual_overlay := terrain.data.get_control_overlay_id(pos)
			var actual_color := terrain.data.get_color(pos)
			var actual_roughness := terrain.data.get_roughness(pos)
			if not _require(not is_nan(actual_height) and not is_nan(actual_blend) and not is_nan(actual_color.r) and not is_nan(actual_roughness), "non-finite G00 Terrain3D aligned bake sample"): return
			if not _require(actual_base == int(expected["base"]) and actual_overlay == int(expected["overlay"]), "G00 Terrain3D control texture IDs drifted"): return
			var actual_road := actual_blend if actual_overlay == road_id and actual_blend > ROAD_ACTIVE_EPS else 0.0
			var actual_path := actual_blend if actual_overlay == path_id and actual_blend > ROAD_ACTIVE_EPS else 0.0
			var actual_snow := (1.0 if actual_base == snow_id else 0.0) if actual_road > 0.0 or actual_path > 0.0 else actual_blend
			var expected_height := _channel(source, "heights", x, z)
			var expected_road := _channel(source, "roadCoverage", x, z)
			var expected_path := _channel(source, "pathCoverage", x, z)
			var expected_snow := _channel(source, "snowSurface", x, z)
			var expected_color := _source_color(source, x, z)
			max_height_error = maxf(max_height_error, absf(actual_height - expected_height))
			max_road_error = maxf(max_road_error, absf(actual_road - expected_road))
			max_path_error = maxf(max_path_error, absf(actual_path - expected_path))
			max_snow_error = maxf(max_snow_error, absf(actual_snow - expected_snow))
			max_color_error = maxf(max_color_error, maxf(absf(actual_color.r - expected_color.r), maxf(absf(actual_color.g - expected_color.g), absf(actual_color.b - expected_color.b))))
			max_roughness_error = maxf(max_roughness_error, absf(actual_roughness - expected_color.a))
			if actual_road > ROAD_ACTIVE_EPS: active_road_samples += 1
			if actual_path > ROAD_ACTIVE_EPS: active_path_samples += 1
			heights.push_back(snappedf(actual_height, 0.000001))
			road_coverage.push_back(snappedf(actual_road, 0.00000001))
			path_coverage.push_back(snappedf(actual_path, 0.00000001))
			snow_surface.push_back(snappedf(actual_snow, 0.00000001))
			tint_r.push_back(snappedf(actual_color.r, 0.00000001))
			tint_g.push_back(snappedf(actual_color.g, 0.00000001))
			tint_b.push_back(snappedf(actual_color.b, 0.00000001))
			roughness_values.push_back(snappedf(actual_roughness, 0.00000001))
			for value in [actual_road, actual_path, actual_snow, actual_color.r, actual_color.g, actual_color.b, actual_roughness]:
				checksum = _hash_u8(checksum, int(round(clampf(value, 0.0, 1.0) * 255.0)))
	if not _require(max_height_error <= HEIGHT_TOLERANCE, "G00 aligned Terrain3D height parity exceeded tolerance"): return
	if not _require(max_road_error <= UNIT_TOLERANCE, "G00 aligned Terrain3D road parity exceeded tolerance"): return
	if not _require(max_path_error <= UNIT_TOLERANCE, "G00 aligned Terrain3D path parity exceeded tolerance"): return
	if not _require(max_snow_error <= UNIT_TOLERANCE, "G00 aligned Terrain3D substrate parity exceeded tolerance"): return
	if not _require(max_color_error <= UNIT_TOLERANCE, "G00 aligned Terrain3D tint parity exceeded tolerance"): return
	if not _require(max_roughness_error <= UNIT_TOLERANCE, "G00 aligned Terrain3D roughness parity exceeded tolerance"): return
	var semantics: Dictionary = source["semanticMetrics"]
	if int(semantics.get("activeRoadSurfaceSamples", 0)) > 0 and not _require(active_road_samples > 0, "qualified G00 road vanished from real Terrain3D bake"): return
	if int(semantics.get("activePathSurfaceSamples", 0)) > 0 and not _require(active_path_samples > 0, "qualified G00 path vanished from real Terrain3D bake"): return

	var boundary_probe_max_height_error := 0.0
	for px in [254.5, 255.0, 255.5, 256.0]:
		for pz in [63.5, 127.5, 191.5, 254.5, 255.5, 256.0]:
			var actual := terrain.data.get_height(Vector3(float(px), 0.0, float(pz)))
			if not _require(not is_nan(actual), "G00 Terrain3D returned NAN at 255/256 guard boundary"): return
			var x0 := clampi(int(floor(px)), 0, 256)
			var z0 := clampi(int(floor(pz)), 0, 256)
			var x1 := mini(x0 + 1, 256)
			var z1 := mini(z0 + 1, 256)
			var tx := float(px) - float(x0)
			var tz := float(pz) - float(z0)
			var top := lerpf(_channel(source, "heights", x0, z0), _channel(source, "heights", x1, z0), tx)
			var bottom := lerpf(_channel(source, "heights", x0, z1), _channel(source, "heights", x1, z1), tx)
			var expected_height := lerpf(top, bottom, tz)
			boundary_probe_max_height_error = maxf(boundary_probe_max_height_error, absf(actual - expected_height))
	if not _require(boundary_probe_max_height_error <= HEIGHT_TOLERANCE, "G00 Terrain3D 255/256 boundary parity exceeded tolerance"): return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "G00 Terrain3D LOD0 bake returned no mesh"): return
	var baked_vertices: PackedVector3Array = baked_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(baked_vertices.size() > 0, "G00 Terrain3D LOD0 bake returned no vertices"): return
	var suffix := OS.get_environment("G00_RUNTIME_PARITY_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var save_dir := "user://g00-terrain3d-runtime-parity-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir))
	terrain.data.save_directory(save_dir)
	var saved := _saved_region_evidence(save_dir)
	if not _require(saved["files"].size() >= 4 and int(saved["totalBytes"]) > 0, "G00 Terrain3D did not persist four guard-backed regions"): return
	if not _require(_write_preview(terrain, source) == OK, "failed to write G00 Terrain3D runtime parity preview"): return

	var bake := {
		"schema": "westeros-g00-terrain3d-bake-v1",
		"policyId": EXPECTED_POLICY,
		"sourceMapSha256": EXPECTED_MAP_SHA,
		"terrain3dVersion": String(terrain.version),
		"lod": 0,
		"width": SOURCE_SIZE,
		"height": SOURCE_SIZE,
		"regionCount": region_count,
		"savedRegionFiles": saved["files"].size(),
		"savedRegionBytes": int(saved["totalBytes"]),
		"bakedSurfaces": baked_mesh.get_surface_count(),
		"bakedVertices": baked_vertices.size(),
		"activeRoadSamples": active_road_samples,
		"activePathSamples": active_path_samples,
		"maxHeightError": snappedf(max_height_error, 0.00000001),
		"maxRoadError": snappedf(max_road_error, 0.00000001),
		"maxPathError": snappedf(max_path_error, 0.00000001),
		"maxSnowError": snappedf(max_snow_error, 0.00000001),
		"maxColorError": snappedf(max_color_error, 0.00000001),
		"maxRoughnessError": snappedf(max_roughness_error, 0.00000001),
		"boundaryProbeMaxHeightError": snappedf(boundary_probe_max_height_error, 0.00000001),
		"bakeChecksum": checksum,
		"heights": heights,
		"roadCoverage": road_coverage,
		"pathCoverage": path_coverage,
		"snowSurface": snow_surface,
		"tintR": tint_r,
		"tintG": tint_g,
		"tintB": tint_b,
		"roughness": roughness_values,
	}
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	var output := FileAccess.open(BAKE_PATH, FileAccess.WRITE)
	if not _require(output != null, "could not open G00 runtime bake JSON output"): return
	output.store_string(JSON.stringify(bake) + "\n")
	output.close()
	print("G00_TERRAIN3D_RUNTIME_BAKE_METRICS=" + JSON.stringify({
		"regionCount": region_count,
		"savedRegionFiles": saved["files"].size(),
		"bakedVertices": baked_vertices.size(),
		"activeRoadSamples": active_road_samples,
		"activePathSamples": active_path_samples,
		"maxHeightError": bake["maxHeightError"],
		"maxRoadError": bake["maxRoadError"],
		"maxPathError": bake["maxPathError"],
		"maxSnowError": bake["maxSnowError"],
		"maxColorError": bake["maxColorError"],
		"maxRoughnessError": bake["maxRoughnessError"],
		"boundaryProbeMaxHeightError": bake["boundaryProbeMaxHeightError"],
		"bakeChecksum": checksum,
	}))
	print("NW_G00_TERRAIN3D_RUNTIME_BAKE_OK")
	quit(0)
