extends SceneTree

const SOURCE_PATH := "res://.terrain3d-proof/g71-relief-source.json"
const METRICS_PATH := "res://.terrain3d-proof/g71-relief-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g71-relief-imported-topdown.png"
const EXPECTED_SCHEMA := "westeros-g71-terrain3d-relief-source-v1"
const EXPECTED_POLICY := "safak-kartali-g71-terrain3d-relief-2026-08-15-v1"
const EXPECTED_HYDROLOGY_POLICY := "safak-kartali-g71-hydrology-2026-08-12-v1"
const EXPECTED_BIOME_POLICY := "safak-kartali-g71-terrain3d-biome-2026-08-15-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const CANONICAL_HEIGHT := -8.0
const HEIGHT_TOLERANCE := 0.001
const NORMAL_TOLERANCE := 0.000001
const MAX_SEAFLOOR_HEIGHT := -2.5

func _initialize() -> void: call_deferred("_run")
func _fail(message: String) -> void: push_error("G71 Terrain3D Relief proof failed: " + message); quit(1)
func _need(ok: bool, message: String) -> bool:
	if not ok: _fail(message); return false
	return true

func _source_height(source: Dictionary, u: float, v: float) -> float:
	var h: Array = source["heights"]
	var gx := clampf(u, 0.0, 1.0) * 64.0; var gy := clampf(v, 0.0, 1.0) * 64.0
	var x0 := int(floor(gx)); var y0 := int(floor(gy)); var x1 := mini(x0 + 1, 64); var y1 := mini(y0 + 1, 64)
	var tx := gx - x0; var ty := gy - y0
	return lerpf(lerpf(float(h[y0 * 65 + x0]), float(h[y0 * 65 + x1]), tx), lerpf(float(h[y1 * 65 + x0]), float(h[y1 * 65 + x1]), tx), ty)

func _height_image(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			image.set_pixel(x, z, Color(_source_height(source, float(x) / 256.0, float(z) / 256.0), 0.0, 0.0, 1.0))
	return image

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null: return {"files": [], "totalBytes": 0}
	var files: Array[String] = []; var total_bytes := 0
	dir.list_dir_begin(); var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			var bytes := FileAccess.get_file_as_bytes(directory.path_join(name))
			if bytes.size() > 0: files.push_back(name); total_bytes += bytes.size()
		name = dir.get_next()
	dir.list_dir_end(); files.sort()
	return {"files": files, "totalBytes": total_bytes}

func _height_hash(checksum: int, value: float) -> int:
	return int((checksum ^ int(round((value + 128.0) * 1000.0))) * 16777619) & 0xffffffff

func _normal_at(data: Terrain3DData, x: float, z: float) -> Vector3:
	var left := maxf(0.0, x - 0.25); var right := minf(256.0, x + 0.25)
	var north := maxf(0.0, z - 0.25); var south := minf(256.0, z + 0.25)
	var dx := (data.get_height(Vector3(right, 0.0, z)) - data.get_height(Vector3(left, 0.0, z))) / maxf(0.000001, right - left)
	var dz := (data.get_height(Vector3(x, 0.0, south)) - data.get_height(Vector3(x, 0.0, north))) / maxf(0.000001, south - north)
	return Vector3(-dx, 1.0, -dz).normalized()

func _write_preview(data: Terrain3DData) -> Error:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGB8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var height := data.get_height(Vector3(float(x), 0.0, float(z)))
			if is_nan(height) or is_inf(height): return ERR_INVALID_DATA
			var depth := clampf(absf(height) / 16.0, 0.0, 1.0)
			image.set_pixel(x, z, Color(0.16, 0.30, 0.36).lerp(Color(0.05, 0.13, 0.18), depth))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	return image.save_png(PREVIEW_PATH)

func _audit_aligned(data: Terrain3DData, source: Dictionary) -> Dictionary:
	var max_error := 0.0; var min_h := INF; var max_h := -INF; var checksum: int = 2166136261; var samples := 0
	for sy in SOURCE_SIZE:
		for sx in SOURCE_SIZE:
			var actual := data.get_height(Vector3(float(sx * 4), 0.0, float(sy * 4)))
			var expected := _source_height(source, float(sx) / 64.0, float(sy) / 64.0)
			if is_nan(actual) or is_inf(actual): return {"error": "non-finite aligned height"}
			max_error = maxf(max_error, absf(actual - expected)); min_h = minf(min_h, actual); max_h = maxf(max_h, actual)
			checksum = _height_hash(checksum, actual); samples += 1
	return {"samples": samples, "maxError": max_error, "minHeight": min_h, "maxHeight": max_h, "checksum": checksum}

func _audit_seams(data: Terrain3DData) -> Dictionary:
	var seam_axis := [254.5, 255.0, 255.5, 256.0]
	var cross_axis := [0.0, 32.25, 64.0, 96.5, 128.0, 160.75, 192.0, 224.5, 256.0]
	var max_height_delta := 0.0; var samples := 0
	for boundary in seam_axis:
		for cross in cross_axis:
			for point in [Vector2(boundary, cross), Vector2(cross, boundary)]:
				var height := data.get_height(Vector3(point.x, 0.0, point.y))
				if is_nan(height) or is_inf(height): return {"error": "non-finite seam height"}
				max_height_delta = maxf(max_height_delta, absf(height - CANONICAL_HEIGHT)); samples += 1
	var normal_axis := [255.0, 255.5, 256.0]
	var normal_cross := [32.25, 96.5, 160.75, 224.5]
	var max_normal_tilt := 0.0; var max_normal_pair_delta := 0.0; var normal_samples := 0
	for cross in normal_cross:
		var previous_x := Vector3.UP; var previous_z := Vector3.UP
		for boundary in normal_axis:
			var nx := _normal_at(data, boundary, cross); var nz := _normal_at(data, cross, boundary)
			max_normal_tilt = maxf(max_normal_tilt, maxf(nx.distance_to(Vector3.UP), nz.distance_to(Vector3.UP)))
			if normal_samples > 0: max_normal_pair_delta = maxf(max_normal_pair_delta, maxf(nx.distance_to(previous_x), nz.distance_to(previous_z)))
			previous_x = nx; previous_z = nz; normal_samples += 2
	return {"heightSamples": samples, "maxHeightDelta": max_height_delta, "normalSamples": normal_samples, "maxNormalTilt": max_normal_tilt, "maxNormalPairDelta": max_normal_pair_delta}

func _run() -> void:
	if not _need(FileAccess.file_exists(SOURCE_PATH), "source JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(SOURCE_PATH)); if not _need(parsed is Dictionary, "source JSON invalid"): return
	var source: Dictionary = parsed
	if not _need(String(source.get("schema", "")) == EXPECTED_SCHEMA, "schema drifted"): return
	if not _need(String(source.get("policyId", "")) == EXPECTED_POLICY, "policy drifted"): return
	if not _need(String(source.get("hydrologyPolicyId", "")) == EXPECTED_HYDROLOGY_POLICY, "hydrology provenance drifted"): return
	if not _need(String(source.get("biomePolicyId", "")) == EXPECTED_BIOME_POLICY, "biome provenance drifted"): return
	if not _need(String(source.get("sourceMapSha256", "")) == EXPECTED_MAP_SHA, "map.png provenance drifted"): return
	if not _need(String(source.get("geoCell", "")) == "G71", "GeoCell drifted"): return
	if not _need(int(source.get("width", 0)) == SOURCE_SIZE and int(source.get("height", 0)) == SOURCE_SIZE, "source must remain 65x65"): return
	if not _need(int(source.get("terrain3dImportSize", 0)) == IMPORT_SIZE and int(source.get("terrain3dRegionSize", 0)) == REGION_SIZE, "Terrain3D geometry contract drifted"): return
	if not _need(source.has("heights") and source["heights"] is Array and (source["heights"] as Array).size() == 4225, "height channel invalid"): return
	for value in source["heights"]:
		var height := float(value)
		if not _need(not is_nan(height) and not is_inf(height) and absf(height - CANONICAL_HEIGHT) <= 0.00000001 and height <= MAX_SEAFLOOR_HEIGHT, "source invented G71 bathymetry"): return

	var terrain := Terrain3D.new(); terrain.name = "G71Terrain3DReliefProof"; get_root().add_child(terrain); terrain.region_size = REGION_SIZE
	if not _need(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	terrain.data.import_images([_height_image(source), null, null], Vector3.ZERO, 0.0, 1.0)
	var region_count := terrain.data.get_region_count(); if not _need(region_count >= 4, "257x257 import did not create >=4 regions"): return
	var aligned := _audit_aligned(terrain.data, source); if not _need(not aligned.has("error"), String(aligned.get("error", "aligned audit failed"))): return
	if not _need(int(aligned["samples"]) == 4225 and float(aligned["maxError"]) <= HEIGHT_TOLERANCE, "aligned roundtrip failed"): return
	if not _need(float(aligned["maxHeight"]) <= MAX_SEAFLOOR_HEIGHT and absf(float(aligned["maxHeight"]) - float(aligned["minHeight"])) <= HEIGHT_TOLERANCE, "import invented height span"): return

	var grid_samples := 0; var grid_checksum: int = 2166136261; var max_grid_delta := 0.0
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var actual := terrain.data.get_height(Vector3(float(x), 0.0, float(z)))
			if not _need(not is_nan(actual) and not is_inf(actual), "full-grid returned invalid height"): return
			max_grid_delta = maxf(max_grid_delta, absf(actual - CANONICAL_HEIGHT)); grid_checksum = _height_hash(grid_checksum, actual); grid_samples += 1
	if not _need(grid_samples == 66049 and max_grid_delta <= HEIGHT_TOLERANCE, "66,049-point full-grid audit failed"): return

	var seams := _audit_seams(terrain.data); if not _need(not seams.has("error"), String(seams.get("error", "seam audit failed"))): return
	if not _need(float(seams["maxHeightDelta"]) <= HEIGHT_TOLERANCE, "255/256 height seam detected"): return
	if not _need(float(seams["maxNormalTilt"]) <= NORMAL_TOLERANCE and float(seams["maxNormalPairDelta"]) <= NORMAL_TOLERANCE, "255/256 normal/derivative seam detected"): return
	var mesh: Mesh = terrain.bake_mesh(0); if not _need(mesh != null and mesh.get_surface_count() > 0, "LOD0 bake empty"): return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]; if not _need(vertices.size() > 0, "LOD0 vertices empty"): return

	var suffix := OS.get_environment("G71_RELIEF_PROOF_SUFFIX"); if suffix.is_empty(): suffix = "default"
	var save_dir := "user://g71-terrain3d-relief-" + suffix; DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir)); terrain.data.save_directory(save_dir)
	var saved := _saved_region_evidence(save_dir); if not _need(saved["files"].size() >= 4 and int(saved["totalBytes"]) > 0, "region persistence failed"): return
	if not _need(_write_preview(terrain.data) == OK, "native top-down PNG failed"): return

	var reloaded := Terrain3D.new(); reloaded.name = "G71Terrain3DReliefReload"; get_root().add_child(reloaded); reloaded.region_size = REGION_SIZE; reloaded.data.load_directory(save_dir)
	if not _need(reloaded.data.get_region_count() >= 4, "reload lost Terrain3D regions"): return
	var reload_aligned := _audit_aligned(reloaded.data, source); if not _need(not reload_aligned.has("error"), "reload aligned audit invalid"): return
	var reload_seams := _audit_seams(reloaded.data); if not _need(not reload_seams.has("error"), "reload seam audit invalid"): return
	if not _need(float(reload_aligned["maxError"]) <= HEIGHT_TOLERANCE and float(reload_seams["maxHeightDelta"]) <= HEIGHT_TOLERANCE, "reload height parity failed"): return
	if not _need(float(reload_seams["maxNormalTilt"]) <= NORMAL_TOLERANCE, "reload normal parity failed"): return
	var reload_mesh: Mesh = reloaded.bake_mesh(0); if not _need(reload_mesh != null and reload_mesh.get_surface_count() > 0, "reload LOD0 bake empty"): return
	var reload_vertices: PackedVector3Array = reload_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]

	var metrics := {
		"schema": "westeros-g71-terrain3d-relief-bake-v1", "policyId": EXPECTED_POLICY, "sourceMapSha256": EXPECTED_MAP_SHA,
		"terrain3dVersion": String(terrain.version), "regionSize": int(terrain.region_size), "regionCount": region_count,
		"alignedSamples": int(aligned["samples"]), "fullGridSamples": grid_samples, "seamSamples": int(seams["heightSamples"]), "normalSamples": int(seams["normalSamples"]),
		"maxHeightError": snappedf(float(aligned["maxError"]), 0.00000001), "maxGridHeightDelta": snappedf(max_grid_delta, 0.00000001),
		"maxSeamHeightDelta": snappedf(float(seams["maxHeightDelta"]), 0.00000001), "maxNormalTilt": snappedf(float(seams["maxNormalTilt"]), 0.00000001), "maxNormalPairDelta": snappedf(float(seams["maxNormalPairDelta"]), 0.00000001),
		"outputChecksum": int(aligned["checksum"]), "fullGridChecksum": grid_checksum, "bakedSurfaces": mesh.get_surface_count(), "bakedVertices": vertices.size(),
		"savedRegionFiles": saved["files"].size(), "savedRegionBytes": int(saved["totalBytes"]), "reloadRegionCount": reloaded.data.get_region_count(),
		"reloadMaxHeightError": snappedf(float(reload_aligned["maxError"]), 0.00000001), "reloadMaxSeamHeightDelta": snappedf(float(reload_seams["maxHeightDelta"]), 0.00000001), "reloadMaxNormalTilt": snappedf(float(reload_seams["maxNormalTilt"]), 0.00000001),
		"reloadChecksum": int(reload_aligned["checksum"]), "reloadBakedVertices": reload_vertices.size()
	}
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof")); var out := FileAccess.open(METRICS_PATH, FileAccess.WRITE)
	if not _need(out != null, "metrics output failed"): return
	out.store_string(JSON.stringify(metrics) + "\n"); out.close(); print("G71_TERRAIN3D_RELIEF_METRICS=" + JSON.stringify(metrics)); print("NE_G71_TERRAIN3D_RELIEF_VALIDATION_OK"); quit(0)
