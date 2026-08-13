extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g01-road-path-probe.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g01-road-path-imported-topdown.png"
const EXPECTED_POLICY := "buzul-muhafizi-g01-terrain3d-road-path-2026-08-13-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_BLEND_ERROR := 0.007
const MAX_HEIGHT_ERROR := 0.00002
const ACTIVE_EPSILON := 0.000001

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G01 Terrain3D road/path proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _source_component(probe: Dictionary, u: float, v: float, component: int) -> float:
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
	var top := lerpf(float(a[component]), float(b[component]), tx)
	var bottom := lerpf(float(c[component]), float(d[component]), tx)
	return lerpf(top, bottom, ty)

func _source_road_coverage(probe: Dictionary, u: float, v: float) -> float:
	return clampf(_source_component(probe, u, v, 0), 0.0, 1.0)

func _source_path_coverage(probe: Dictionary, u: float, v: float) -> float:
	return clampf(_source_component(probe, u, v, 1), 0.0, 1.0)

func _source_corridor_coverage(probe: Dictionary, u: float, v: float) -> float:
	return maxf(_source_road_coverage(probe, u, v), _source_path_coverage(probe, u, v))

func _source_height(probe: Dictionary, u: float, v: float) -> float:
	return _source_component(probe, u, v, 3)

func _source_snow_weight(probe: Dictionary, u: float, v: float) -> float:
	return clampf(_source_component(probe, u, v, 5), 0.0, 1.0)

func _expected_overlay(probe: Dictionary, u: float, v: float) -> int:
	var road := _source_road_coverage(probe, u, v)
	var path := _source_path_coverage(probe, u, v)
	var coverage := maxf(road, path)
	if coverage <= ACTIVE_EPSILON:
		return int(probe["snowTextureId"])
	return int(probe["roadTextureId"]) if road >= path else int(probe["pathTextureId"])

func _expected_blend(probe: Dictionary, u: float, v: float) -> float:
	var coverage := _source_corridor_coverage(probe, u, v)
	return coverage if coverage > ACTIVE_EPSILON else _source_snow_weight(probe, u, v)

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
	var base_id := int(probe["rockTextureId"])
	var image := Image.create_empty(region_size, region_size, false, Image.FORMAT_RF)
	for z in region_size:
		var v := float(z) / float(region_size - 1)
		for x in region_size:
			var u := float(x) / float(region_size - 1)
			var overlay_id := _expected_overlay(probe, u, v)
			var blend_u8 := int(round(_expected_blend(probe, u, v) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(base_id) | Terrain3DUtil.enc_overlay(overlay_id) | Terrain3DUtil.enc_blend(blend_u8)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0.0, 0.0, 1.0))
	return image

func _write_imported_preview(terrain: Terrain3D, probe: Dictionary) -> Error:
	var region_size := int(probe["terrain3dRegionSize"])
	var image := Image.create_empty(region_size, region_size, false, Image.FORMAT_RGBA8)
	var rock := Color(0.25, 0.28, 0.31, 1.0)
	var snow := Color(0.91, 0.95, 0.97, 1.0)
	var road := Color(0.55, 0.42, 0.25, 1.0)
	var path := Color(0.44, 0.36, 0.23, 1.0)
	var sea := Color(0.08, 0.18, 0.25, 1.0)
	for z in region_size:
		for x in region_size:
			var pos := Vector3(float(x), 0.0, float(z))
			var blend := terrain.data.get_control_blend(pos)
			var overlay_id := terrain.data.get_control_overlay_id(pos)
			var height := terrain.data.get_height(pos)
			if is_nan(blend) or is_nan(height):
				return ERR_INVALID_DATA
			var target := snow
			if overlay_id == int(probe["roadTextureId"]): target = road
			elif overlay_id == int(probe["pathTextureId"]): target = path
			var color := rock.lerp(target, clampf(blend, 0.0, 1.0))
			if height < 0.0 and overlay_id == int(probe["snowTextureId"]): color = sea
			image.set_pixel(x, z, color)
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	return image.save_png(PREVIEW_PATH)

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null:
		_fail("Terrain3D G01 road/path save directory was not created")
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
	if not _require(FileAccess.file_exists(PROBE_PATH), "G01 road/path probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON did not decode to Dictionary"): return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected G01 road/path policy"): return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "owner-map SHA changed"): return
	if not _require(int(probe["sourceGridSize"]) == 257, "G01 road/path source must be 257x257"): return
	if not _require(int(probe["terrain3dRegionSize"]) == 256, "Terrain3D proof must use region size 256"): return
	if not _require(int(probe["rockTextureId"]) == 0 and int(probe["snowTextureId"]) == 1, "qualified G01 substrate texture IDs changed"): return
	if not _require(int(probe["roadTextureId"]) == 2 and int(probe["pathTextureId"]) == 3, "G01 road/path texture IDs changed"): return

	var terrain := Terrain3D.new()
	terrain.name = "G01Terrain3DRoadPathProof"
	get_root().add_child(terrain)
	terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return

	var height_image := _build_height_image(probe)
	var control_image := _build_control_image(probe)
	terrain.data.import_images([height_image, control_image, null], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() == 1, "Terrain3D G01 road/path import must produce exactly one region"): return

	var base_id := int(probe["rockTextureId"])
	var sample_positions: Array[int] = []
	for coordinate in range(0, 256, 8): sample_positions.push_back(coordinate)
	if sample_positions[-1] != 255: sample_positions.push_back(255)
	var max_blend_error := 0.0
	var max_height_error := 0.0
	var checksum: int = 2166136261
	var sample_count := 0
	var active_source_samples := 0
	var active_roundtrip_samples := 0
	var substrate_source_samples := 0
	var substrate_roundtrip_samples := 0
	for z in sample_positions:
		for x in sample_positions:
			var u := float(x) / 255.0
			var v := float(z) / 255.0
			var source_coverage := _source_corridor_coverage(probe, u, v)
			var expected_blend := _expected_blend(probe, u, v)
			var expected_overlay := _expected_overlay(probe, u, v)
			var expected_height := _source_height(probe, u, v)
			var pos := Vector3(float(x), 0.0, float(z))
			var actual_base := terrain.data.get_control_base_id(pos)
			var actual_overlay := terrain.data.get_control_overlay_id(pos)
			var actual_blend := terrain.data.get_control_blend(pos)
			var actual_height := terrain.data.get_height(pos)
			if not _require(actual_base == base_id, "Terrain3D G01 road/path base texture ID changed"): return
			if not _require(actual_overlay == expected_overlay, "Terrain3D G01 road/path overlay texture ID changed"): return
			if not _require(not is_nan(actual_blend) and not is_nan(actual_height), "Terrain3D G01 road/path control/height returned NaN"): return
			max_blend_error = maxf(max_blend_error, absf(actual_blend - expected_blend))
			max_height_error = maxf(max_height_error, absf(actual_height - expected_height))
			if source_coverage > 0.02:
				active_source_samples += 1
				if actual_blend > 0.02 and (actual_overlay == int(probe["roadTextureId"]) or actual_overlay == int(probe["pathTextureId"])):
					active_roundtrip_samples += 1
			elif source_coverage <= ACTIVE_EPSILON:
				substrate_source_samples += 1
				if actual_overlay == int(probe["snowTextureId"]) and absf(actual_blend - _source_snow_weight(probe, u, v)) <= MAX_BLEND_ERROR:
					substrate_roundtrip_samples += 1
			var quantized := int(round(clampf(actual_blend, 0.0, 1.0) * 255.0))
			checksum = int((checksum ^ quantized) * 16777619) & 0xffffffff
			sample_count += 1
	if not _require(max_blend_error <= MAX_BLEND_ERROR, "Terrain3D G01 road/path/substrate blend roundtrip exceeded tolerance"): return
	if not _require(max_height_error <= MAX_HEIGHT_ERROR, "Terrain3D G01 road/path import changed qualified Relief height"): return
	if active_source_samples > 0 and not _require(active_roundtrip_samples > 0, "active live G01 road/path vanished during Terrain3D roundtrip"): return
	if active_source_samples == 0 and not _require(active_roundtrip_samples == 0, "Terrain3D invented active G01 road/path for an empty source corridor field"): return
	if not _require(substrate_source_samples > 0 and substrate_roundtrip_samples == substrate_source_samples, "road-free G01 Rock/Snow substrate was not preserved through Terrain3D"): return

	if not _require(_write_imported_preview(terrain, probe) == OK, "failed to write imported G01 road/path top-down preview"): return
	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "Terrain3D LOD0 G01 road/path bake returned no mesh"): return
	var arrays := baked_mesh.surface_get_arrays(0)
	var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "Terrain3D LOD0 G01 road/path bake returned no vertices"): return

	var suffix := OS.get_environment("G01_ROAD_PATH_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var output_dir := "user://g01-terrain3d-road-path-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	terrain.data.save_directory(output_dir)
	var saved := _saved_region_evidence(output_dir)
	if not _require(saved["files"].size() >= 1 and int(saved["totalBytes"]) > 0, "Terrain3D G01 road/path region resource was not persisted"): return

	print("G01_TERRAIN3D_ROAD_PATH_METRICS=" + JSON.stringify({
		"terrain3dVersion": String(terrain.version),
		"regionSize": int(terrain.region_size),
		"regionCount": terrain.data.get_region_count(),
		"sampleCount": sample_count,
		"activeSourceSamples": active_source_samples,
		"activeRoundtripSamples": active_roundtrip_samples,
		"substrateSourceSamples": substrate_source_samples,
		"substrateRoundtripSamples": substrate_roundtrip_samples,
		"maxBlendError": snappedf(max_blend_error, 0.00000001),
		"maxHeightError": snappedf(max_height_error, 0.00000001),
		"outputChecksum": checksum,
		"bakedSurfaces": baked_mesh.get_surface_count(),
		"bakedVertices": vertices.size(),
		"savedRegionFiles": saved["files"].size(),
		"savedRegionBytes": int(saved["totalBytes"]),
		"previewPath": PREVIEW_PATH,
	}))
	print("NW_G01_TERRAIN3D_ROAD_PATH_VALIDATION_OK")
	quit(0)
