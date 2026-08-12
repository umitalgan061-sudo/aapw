extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g52-probe.json"
const EXPECTED_POLICY := "safak-kartali-g52-terrain3d-hydrology-2026-08-12-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_HEIGHT_ERROR := 0.00001

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G52 Terrain3D proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _halo_water(probe: Dictionary, cell_x: int, cell_y: int) -> float:
	var origin: Dictionary = probe["haloOrigin"]
	var local_x := cell_x - int(origin["x"])
	var local_y := cell_y - int(origin["y"])
	var rows: Array = probe["rows"]
	if local_y < 0 or local_y >= rows.size():
		_fail("halo Y sample escaped emitted owner-map probe")
		return 0.0
	var row: Array = rows[local_y]
	if local_x < 0 or local_x >= row.size():
		_fail("halo X sample escaped emitted owner-map probe")
		return 0.0
	return float(row[local_x])

func _water_confidence(probe: Dictionary, normalized_x: float, normalized_y: float) -> float:
	var grid_x := normalized_x * float(probe["baseMaskWidth"]) - 0.5
	var grid_y := normalized_y * float(probe["baseMaskHeight"]) - 0.5
	var x0 := int(floor(grid_x))
	var y0 := int(floor(grid_y))
	var tx := grid_x - float(x0)
	var ty := grid_y - float(y0)
	var w00 := _halo_water(probe, x0, y0)
	var w10 := _halo_water(probe, x0 + 1, y0)
	var w01 := _halo_water(probe, x0, y0 + 1)
	var w11 := _halo_water(probe, x0 + 1, y0 + 1)
	var top := lerpf(w00, w10, tx)
	var bottom := lerpf(w01, w11, tx)
	return clampf(lerpf(top, bottom, ty), 0.0, 1.0)

func _build_height_image(probe: Dictionary) -> Image:
	var region_size := int(probe["terrain3dRegionSize"])
	var dry_height := float(probe["dryHeightMeters"])
	var water_height := float(probe["waterHeightMeters"])
	var bounds: Dictionary = probe["normalizedBounds"]
	var image := Image.create_empty(region_size, region_size, false, Image.FORMAT_RF)
	for z in region_size:
		var ny := lerpf(float(bounds["yMin"]), float(bounds["yMax"]), float(z) / float(region_size - 1))
		for x in region_size:
			var nx := lerpf(float(bounds["xMin"]), float(bounds["xMax"]), float(x) / float(region_size - 1))
			var confidence := _water_confidence(probe, nx, ny)
			var height := lerpf(dry_height, water_height, confidence)
			image.set_pixel(x, z, Color(height, 0.0, 0.0, 1.0))
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
			var absolute := directory.path_join(name)
			var bytes := FileAccess.get_file_as_bytes(absolute)
			total_bytes += bytes.size()
		name = dir.get_next()
	dir.list_dir_end()
	files.sort()
	return {"files": files, "totalBytes": total_bytes}

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "canonical probe JSON missing"):
		return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON did not decode to Dictionary"):
		return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected G52 policy id"):
		return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "owner-map SHA changed"):
		return
	if not _require(int(probe["terrain3dRegionSize"]) == 256, "Terrain3D proof must use a real 256 region"):
		return

	var terrain := Terrain3D.new()
	terrain.name = "G52Terrain3DProof"
	get_root().add_child(terrain)
	terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 class did not load"):
		return

	var height_image := _build_height_image(probe)
	terrain.data.import_images([height_image, null, null], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 1, "Terrain3D import produced no real regions"):
		return

	var sample_positions: Array[int] = []
	for coordinate in range(0, 256, 16):
		sample_positions.push_back(coordinate)
	if sample_positions[-1] != 255:
		sample_positions.push_back(255)
	var max_error := 0.0
	var output_checksum: int = 2166136261
	var sample_count := 0
	for z in sample_positions:
		for x in sample_positions:
			var actual := terrain.data.get_height(Vector3(float(x), 0.0, float(z)))
			if is_nan(actual):
				_fail("Terrain3D returned NaN for imported G52 height")
				return
			var expected := height_image.get_pixel(x, z).r
			max_error = maxf(max_error, absf(actual - expected))
			var quantized := int(round((actual + 10.0) * 100000.0))
			output_checksum = int((output_checksum ^ quantized) * 16777619) & 0xffffffff
			sample_count += 1
	if not _require(max_error <= MAX_HEIGHT_ERROR, "Terrain3D imported height drift exceeded tolerance"):
		return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "Terrain3D LOD0 bake returned no mesh"):
		return
	var arrays := baked_mesh.surface_get_arrays(0)
	var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "Terrain3D LOD0 bake returned no vertices"):
		return

	var suffix := OS.get_environment("G52_PROOF_SUFFIX")
	if suffix.is_empty():
		suffix = "default"
	var output_dir := "user://g52-terrain3d-proof-" + suffix
	var absolute_dir := ProjectSettings.globalize_path(output_dir)
	DirAccess.make_dir_recursive_absolute(absolute_dir)
	terrain.data.save_directory(output_dir)
	var saved := _saved_region_evidence(output_dir)
	if not _require(saved.has("files") and saved["files"].size() >= 1, "Terrain3D save_directory emitted no region resource"):
		return
	if not _require(int(saved["totalBytes"]) > 0, "Terrain3D saved region resource was empty"):
		return

	var metrics := {
		"terrain3dVersion": String(terrain.version),
		"regionSize": int(terrain.region_size),
		"regionCount": terrain.data.get_region_count(),
		"sampleCount": sample_count,
		"maxHeightError": snappedf(max_error, 0.00000001),
		"outputChecksum": output_checksum,
		"bakedSurfaces": baked_mesh.get_surface_count(),
		"bakedVertices": vertices.size(),
		"savedRegionFiles": saved["files"].size(),
		"savedRegionBytes": int(saved["totalBytes"]),
	}
	print("G52_TERRAIN3D_METRICS=" + JSON.stringify(metrics))
	print("NE_G52_TERRAIN3D_VALIDATION_OK")
	quit(0)
