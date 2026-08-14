extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g75-road-path-probe.json"
const EXPECTED_POLICY := "kizil-ufuk-g75-terrain3d-road-path-2026-08-13-v2"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_BLEND_ERROR := 0.006

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G75 Terrain3D road/path proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

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

func _source_blend(probe: Dictionary, u: float, v: float) -> float:
	return clampf(_source_value(probe, u, v, 3), 0.0, 1.0)

func _source_height(probe: Dictionary, u: float, v: float) -> float:
	return _source_value(probe, u, v, 4)

func _validate_no_phantom_roads(probe: Dictionary) -> bool:
	var rows: Array = probe["rows"]
	var source_samples := 0
	for row_variant in rows:
		var row: Array = row_variant
		for sample_variant in row:
			var sample: Array = sample_variant
			source_samples += 1
			if not _require(absf(float(sample[5])) <= 0.00000001, "phantom road weight present in G75 source probe"): return false
			if not _require(absf(float(sample[6])) <= 0.00000001, "phantom path weight present in G75 source probe"): return false
	return _require(source_samples == 4225, "expected 65x65 road/path source samples")

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

func _write_imported_preview(terrain: Terrain3D, probe: Dictionary) -> Error:
	var region_size := int(probe["terrain3dRegionSize"])
	var image := Image.create_empty(region_size, region_size, false, Image.FORMAT_RGBA8)
	for z in region_size:
		for x in region_size:
			var blend := terrain.data.get_control_blend(Vector3(float(x), 0.0, float(z)))
			if is_nan(blend): blend = 0.0
			var ground := Color(0.36, 0.30, 0.22, 1.0)
			var rock := Color(0.31, 0.30, 0.28, 1.0)
			image.set_pixel(x, z, ground.lerp(rock, clampf(blend, 0.0, 1.0)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	return image.save_png("res://.terrain3d-proof/g75-road-path-imported-topdown.png")

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
	if not _require(FileAccess.file_exists(PROBE_PATH), "G75 road/path probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON did not decode to Dictionary"): return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected G75 road/path policy"): return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "owner-map SHA changed"): return
	if not _require(int(probe["terrain3dRegionSize"]) == 256, "proof must use Terrain3D region size 256"): return
	if not _require(float(probe["canonicalRoadExclusionMarginMeters"]) > 1000.0, "canonical road exclusion margin is no longer safe"): return
	if not _require((probe["crossingEdges"] as Array).is_empty(), "runtime road/path now crosses G75"): return
	if not _validate_no_phantom_roads(probe): return

	var ground_id := int(probe["groundTextureId"])
	var rock_id := int(probe["rockTextureId"])
	var road_id := int(probe["roadTextureId"])
	var path_id := int(probe["pathTextureId"])
	if not _require(road_id != ground_id and road_id != rock_id, "road texture slot must stay distinct even when unused in G75"): return
	if not _require(path_id != ground_id and path_id != rock_id and path_id != road_id, "path texture slot must stay distinct even when unused in G75"): return

	var terrain := Terrain3D.new()
	terrain.name = "G75Terrain3DRoadPathProof"
	get_root().add_child(terrain)
	terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return

	var height_image := _build_height_image(probe)
	var control_image := _build_control_image(probe)
	terrain.data.import_images([height_image, control_image, null], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 1, "Terrain3D import produced no real region"): return

	var sample_positions: Array[int] = []
	for coordinate in range(0, 256, 16): sample_positions.push_back(coordinate)
	if sample_positions[-1] != 255: sample_positions.push_back(255)
	var max_blend_error := 0.0
	var checksum: int = 2166136261
	var sample_count := 0
	for z in sample_positions:
		for x in sample_positions:
			var expected_blend := _source_blend(probe, float(x) / 255.0, float(z) / 255.0)
			var pos := Vector3(float(x), 0.0, float(z))
			if not _require(terrain.data.get_control_base_id(pos) == ground_id, "Terrain3D base texture ID changed"): return
			if not _require(terrain.data.get_control_overlay_id(pos) == rock_id, "Terrain3D overlay texture ID changed or phantom road material appeared"): return
			var actual_blend := terrain.data.get_control_blend(pos)
			if not _require(not is_nan(actual_blend), "Terrain3D control blend returned NAN"): return
			max_blend_error = maxf(max_blend_error, absf(actual_blend - expected_blend))
			checksum = int((checksum ^ int(round(clampf(actual_blend, 0.0, 1.0) * 255.0))) * 16777619) & 0xffffffff
			sample_count += 1
	if not _require(max_blend_error <= MAX_BLEND_ERROR, "Terrain3D control-map roundtrip exceeded tolerance"): return
	if not _require(_write_imported_preview(terrain, probe) == OK, "failed to write imported top-down preview"): return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "Terrain3D LOD0 bake returned no mesh"): return
	var vertices: PackedVector3Array = baked_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "Terrain3D LOD0 bake returned no vertices"): return

	var suffix := OS.get_environment("G75_ROAD_PATH_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var output_dir := "user://g75-terrain3d-road-path-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	terrain.data.save_directory(output_dir)
	var saved := _saved_region_evidence(output_dir)
	if not _require(saved["files"].size() >= 1 and int(saved["totalBytes"]) > 0, "Terrain3D region resource was not persisted"): return

	var metrics := {
		"terrain3dVersion": String(terrain.version),
		"regionSize": int(terrain.region_size),
		"regionCount": terrain.data.get_region_count(),
		"sampleCount": sample_count,
		"maxBlendError": snappedf(max_blend_error, 0.00000001),
		"outputChecksum": checksum,
		"canonicalRoadExclusionMarginMeters": float(probe["canonicalRoadExclusionMarginMeters"]),
		"phantomRoadSamples": 0,
		"phantomPathSamples": 0,
		"bakedSurfaces": baked_mesh.get_surface_count(),
		"bakedVertices": vertices.size(),
		"savedRegionFiles": saved["files"].size(),
		"savedRegionBytes": int(saved["totalBytes"]),
	}
	print("G75_TERRAIN3D_ROAD_PATH_METRICS=" + JSON.stringify(metrics))
	print("SE_G75_TERRAIN3D_ROAD_PATH_VALIDATION_OK")
	quit(0)
