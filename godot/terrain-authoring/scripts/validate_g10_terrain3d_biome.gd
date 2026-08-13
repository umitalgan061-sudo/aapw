extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g10-biome-probe.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g10-biome-color.png"
const EXPECTED_POLICY := "buzul-muhafizi-g10-terrain3d-biome-2026-08-13-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_COLOR_ERROR := 0.012
const MAX_HEIGHT_ERROR := 0.012

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G10 Terrain3D biome proof failed: " + message)
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

func _source_color(probe: Dictionary, u: float, v: float) -> Color:
	return Color(
		clampf(_source_value(probe, u, v, 0), 0.0, 1.0),
		clampf(_source_value(probe, u, v, 1), 0.0, 1.0),
		clampf(_source_value(probe, u, v, 2), 0.0, 1.0),
		1.0
	)

func _source_height(probe: Dictionary, u: float, v: float) -> float:
	var water := clampf(_source_value(probe, u, v, 3), 0.0, 1.0)
	# Proof-only hydrology-preserving height: land +8m, water -8m, 0m at the
	# continuous 0.5 coastline. Relief/Height Character is a later layer.
	return lerpf(8.0, -8.0, water)

func _build_height_image(probe: Dictionary) -> Image:
	var region_size := int(probe["terrain3dRegionSize"])
	var image := Image.create_empty(region_size, region_size, false, Image.FORMAT_RF)
	for z in region_size:
		var v := float(z) / float(region_size - 1)
		for x in region_size:
			var u := float(x) / float(region_size - 1)
			image.set_pixel(x, z, Color(_source_height(probe, u, v), 0.0, 0.0, 1.0))
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

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null:
		_fail("Terrain3D G10 biome save directory missing")
		return {}
	var files := 0
	var total_bytes := 0
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			files += 1
			total_bytes += FileAccess.get_file_as_bytes(directory.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end()
	return {"files": files, "totalBytes": total_bytes}

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "G10 biome probe missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "G10 biome probe decode failed"): return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "G10 biome policy drift"): return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "map.png provenance drift"): return
	if not _require(int(probe["sourceGridSize"]) == 65, "G10 biome source grid must be 65x65"): return
	if not _require(int(probe["terrain3dRegionSize"]) == 256, "Terrain3D region size drift"): return
	if not _require(String(probe["hydrologyFingerprint"]) == "60 water / 36 land / 30 internal boundary edges / 0 centre mismatches", "G10 hydrology fingerprint drift"): return

	var terrain := Terrain3D.new()
	terrain.name = "G10Terrain3DBiomeProof"
	get_root().add_child(terrain)
	terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return

	var height_image := _build_height_image(probe)
	var color_image := _build_color_image(probe)
	terrain.data.import_images([height_image, null, color_image], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() == 1, "G10 biome import must create one real Terrain3D region"): return

	var max_height_error := 0.0
	var max_color_error := 0.0
	var sample_count := 0
	var checksum: int = 2166136261
	for z in range(0, 256, 16):
		for x in range(0, 256, 16):
			var u := float(x) / 255.0
			var v := float(z) / 255.0
			var pos := Vector3(float(x), 0.0, float(z))
			var expected_height := _source_height(probe, u, v)
			var expected_color := _source_color(probe, u, v)
			var actual_height := terrain.data.get_height(pos)
			var actual_color := terrain.data.get_color(pos)
			if not _require(not is_nan(actual_height) and not is_nan(actual_color.r), "Terrain3D G10 biome roundtrip returned NaN"): return
			max_height_error = maxf(max_height_error, absf(actual_height - expected_height))
			max_color_error = maxf(max_color_error, maxf(absf(actual_color.r - expected_color.r), maxf(absf(actual_color.g - expected_color.g), absf(actual_color.b - expected_color.b))))
			for value in [actual_color.r, actual_color.g, actual_color.b]:
				checksum = int((checksum ^ int(round(clampf(float(value), 0.0, 1.0) * 255.0))) * 16777619) & 0xffffffff
			sample_count += 1
	if not _require(max_height_error <= MAX_HEIGHT_ERROR, "G10 hydrology-preserving height roundtrip exceeded tolerance"): return
	if not _require(max_color_error <= MAX_COLOR_ERROR, "G10 biome color roundtrip exceeded tolerance"): return

	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	if not _require(terrain.data.export_image(PREVIEW_PATH, Terrain3DRegion.TYPE_COLOR) == OK, "G10 biome color export failed"): return
	if not _require(FileAccess.file_exists(PREVIEW_PATH), "G10 biome visual proof missing"): return
	var visual_bytes := FileAccess.get_file_as_bytes(PREVIEW_PATH).size()
	if not _require(visual_bytes > 0, "G10 biome visual proof empty"): return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "G10 biome LOD0 bake returned no mesh"): return
	var vertices: PackedVector3Array = baked_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "G10 biome LOD0 bake returned no vertices"): return

	var suffix := OS.get_environment("G10_BIOME_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var output_dir := "user://g10-terrain3d-biome-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	terrain.data.save_directory(output_dir)
	var saved := _saved_region_evidence(output_dir)
	if not _require(int(saved["files"]) >= 1 and int(saved["totalBytes"]) > 0, "G10 biome Terrain3D region persistence empty"): return

	print("G10_TERRAIN3D_BIOME_METRICS=" + JSON.stringify({
		"terrain3dVersion": String(terrain.version),
		"regionSize": int(terrain.region_size),
		"regionCount": terrain.data.get_region_count(),
		"sampleCount": sample_count,
		"maxHeightError": snappedf(max_height_error, 0.00000001),
		"maxColorError": snappedf(max_color_error, 0.00000001),
		"colorChecksum": checksum,
		"bakedSurfaces": baked_mesh.get_surface_count(),
		"bakedVertices": vertices.size(),
		"savedRegionFiles": int(saved["files"]),
		"savedRegionBytes": int(saved["totalBytes"]),
		"visualProofBytes": visual_bytes,
	}))
	print("NW_G10_TERRAIN3D_BIOME_VALIDATION_OK")
	quit(0)
