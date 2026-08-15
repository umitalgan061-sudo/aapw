extends SceneTree

const SOURCE_PATH := "res://.terrain3d-proof/g71-biome-source.json"
const BAKE_PATH := "res://.terrain3d-proof/g71-biome-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g71-biome-topdown.png"
const EXPECTED_SCHEMA := "westeros-g71-terrain3d-biome-source-v1"
const EXPECTED_POLICY := "safak-kartali-g71-terrain3d-biome-2026-08-15-v1"
const EXPECTED_HYDROLOGY := "safak-kartali-g71-hydrology-2026-08-12-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const HEIGHT_TOLERANCE := 0.001
const MATERIAL_TOLERANCE := 0.006
const MAX_SEAFLOOR_HEIGHT := -2.5
const BOUNDARY_AXIS := [0.0, 64.0, 128.0, 192.0, 255.0, 256.0]

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G71 Terrain3D biome proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _channel(source: Dictionary, name: String, u: float, v: float) -> float:
	var values: Array = source[name]
	var gx: float = clampf(u, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var gy: float = clampf(v, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var x0 := int(floor(gx)); var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, SOURCE_SIZE - 1); var y1 := mini(y0 + 1, SOURCE_SIZE - 1)
	var tx: float = gx - float(x0); var ty: float = gy - float(y0)
	var a := float(values[y0 * SOURCE_SIZE + x0]); var b := float(values[y0 * SOURCE_SIZE + x1])
	var c := float(values[y1 * SOURCE_SIZE + x0]); var d := float(values[y1 * SOURCE_SIZE + x1])
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
			var u: float = float(x) / 256.0; var v: float = float(z) / 256.0
			image.set_pixel(x, z, Color(_channel(source, "colorR", u, v), _channel(source, "colorG", u, v), _channel(source, "colorB", u, v), _channel(source, "roughness", u, v)))
	return image

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null: return {"files": 0, "bytes": 0}
	var files := 0; var bytes := 0
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			var content := FileAccess.get_file_as_bytes(directory.path_join(name))
			if content.size() > 0: files += 1; bytes += content.size()
		name = dir.get_next()
	dir.list_dir_end()
	return {"files": files, "bytes": bytes}

func _write_topdown(terrain: Terrain3D) -> Error:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var pos := Vector3(float(x), 0.0, float(z))
			var color := terrain.data.get_color(pos); var roughness := terrain.data.get_roughness(pos)
			if is_nan(color.r) or is_nan(color.g) or is_nan(color.b) or is_nan(roughness): return ERR_INVALID_DATA
			image.set_pixel(x, z, Color(color.r, color.g, color.b, clampf(roughness, 0.0, 1.0)))
	return image.save_png(PREVIEW_PATH)

func _run() -> void:
	if not _require(FileAccess.file_exists(SOURCE_PATH), "source JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(SOURCE_PATH))
	if not _require(parsed is Dictionary, "source JSON invalid"): return
	var source: Dictionary = parsed
	if not _require(String(source.get("schema", "")) == EXPECTED_SCHEMA, "schema drifted"): return
	if not _require(String(source.get("policyId", "")) == EXPECTED_POLICY, "policy drifted"): return
	if not _require(String(source.get("hydrologyPolicyId", "")) == EXPECTED_HYDROLOGY, "hydrology provenance drifted"): return
	if not _require(String(source.get("sourceMapSha256", "")) == EXPECTED_MAP_SHA, "map.png provenance drifted"): return
	if not _require(String(source.get("geoCell", "")) == "G71", "GeoCell drifted"): return
	if not _require(int(source.get("width", 0)) == SOURCE_SIZE and int(source.get("height", 0)) == SOURCE_SIZE, "source must remain 65x65"): return
	if not _require(int(source.get("terrain3dImportSize", 0)) == IMPORT_SIZE and int(source.get("terrain3dRegionSize", 0)) == REGION_SIZE, "Terrain3D dimensions drifted"): return
	for name in ["heights", "waterConfidence", "colorR", "colorG", "colorB", "roughness"]:
		if not _require(source.has(name) and source[name] is Array and (source[name] as Array).size() == SOURCE_SIZE * SOURCE_SIZE, "invalid channel " + name): return
	for value in source["heights"]:
		var height := float(value)
		if not _require(not is_nan(height) and not is_inf(height) and height <= MAX_SEAFLOOR_HEIGHT, "source escaped open-sea depth"): return
	for value in source["waterConfidence"]:
		if not _require(absf(float(value) - 1.0) <= 0.00000001, "water confidence drifted"): return

	var terrain := Terrain3D.new()
	terrain.name = "G71Terrain3DBiomeProof"; get_root().add_child(terrain); terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	terrain.data.import_images([_height_image(source), null, _color_image(source)], Vector3.ZERO, 0.0, 1.0)
	var region_count := terrain.data.get_region_count()
	if not _require(region_count >= 4, "257x257 import did not create >=4 regions"): return

	var max_height_error := 0.0; var max_color_error := 0.0; var max_roughness_error := 0.0; var aligned_samples := 0
	for sy in SOURCE_SIZE:
		for sx in SOURCE_SIZE:
			var u: float = float(sx) / 64.0; var v: float = float(sy) / 64.0
			var pos := Vector3(float(sx * 4), 0.0, float(sy * 4))
			var height := terrain.data.get_height(pos); var color := terrain.data.get_color(pos); var roughness := terrain.data.get_roughness(pos)
			if not _require(not is_nan(height) and not is_inf(height) and height <= MAX_SEAFLOOR_HEIGHT, "imported height invalid"): return
			max_height_error = maxf(max_height_error, absf(height - _channel(source, "heights", u, v)))
			max_color_error = maxf(max_color_error, maxf(absf(color.r - _channel(source, "colorR", u, v)), maxf(absf(color.g - _channel(source, "colorG", u, v)), absf(color.b - _channel(source, "colorB", u, v)))))
			max_roughness_error = maxf(max_roughness_error, absf(roughness - _channel(source, "roughness", u, v)))
			aligned_samples += 1
	if not _require(aligned_samples == 4225, "aligned sample count drifted"): return
	if not _require(max_height_error <= HEIGHT_TOLERANCE and max_color_error <= MATERIAL_TOLERANCE and max_roughness_error <= MATERIAL_TOLERANCE, "Terrain3D round-trip exceeded tolerance"): return

	var max_seam_height := 0.0; var max_seam_color := 0.0; var max_seam_roughness := 0.0; var seam_pairs := 0
	for axis in BOUNDARY_AXIS:
		for pair in [[Vector3(255.0, 0.0, axis), Vector3(256.0, 0.0, axis)], [Vector3(axis, 0.0, 255.0), Vector3(axis, 0.0, 256.0)]]:
			var a: Vector3 = pair[0]; var b: Vector3 = pair[1]
			var ah := terrain.data.get_height(a); var bh := terrain.data.get_height(b)
			var ac := terrain.data.get_color(a); var bc := terrain.data.get_color(b)
			var ar := terrain.data.get_roughness(a); var br := terrain.data.get_roughness(b)
			max_seam_height = maxf(max_seam_height, absf(ah - bh))
			max_seam_color = maxf(max_seam_color, maxf(absf(ac.r - bc.r), maxf(absf(ac.g - bc.g), absf(ac.b - bc.b))))
			max_seam_roughness = maxf(max_seam_roughness, absf(ar - br)); seam_pairs += 1
	if not _require(seam_pairs == 12, "255/256 seam probe count drifted"): return
	if not _require(max_seam_height <= HEIGHT_TOLERANCE and max_seam_color <= MATERIAL_TOLERANCE and max_seam_roughness <= MATERIAL_TOLERANCE, "Terrain3D region seam detected"): return

	var baked: Mesh = terrain.bake_mesh(0)
	if not _require(baked != null and baked.get_surface_count() > 0, "LOD0 bake returned no surface"): return
	var vertices: PackedVector3Array = baked.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "LOD0 bake returned no vertices"): return
	var suffix := OS.get_environment("G71_BIOME_PROOF_SUFFIX"); if suffix.is_empty(): suffix = "default"
	var save_dir := "user://g71-terrain3d-biome-" + suffix; DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir)); terrain.data.save_directory(save_dir)
	var saved := _saved_region_evidence(save_dir)
	if not _require(int(saved["files"]) >= 4 and int(saved["bytes"]) > 0, "Terrain3D persistence incomplete"): return
	if not _require(_write_topdown(terrain) == OK, "native top-down proof failed"): return
	var metrics := {"geoCell":"G71", "regionCount":region_count, "persistedFiles":saved["files"], "persistedBytes":saved["bytes"], "alignedSamples":aligned_samples, "boundaryProbePairs":seam_pairs, "bakedVertices":vertices.size(), "maxHeightError":max_height_error, "maxColorError":max_color_error, "maxRoughnessError":max_roughness_error, "maxRegionHeightDelta":max_seam_height, "maxRegionColorDelta":max_seam_color, "maxRegionRoughnessDelta":max_seam_roughness}
	var file := FileAccess.open(BAKE_PATH, FileAccess.WRITE)
	if not _require(file != null, "failed to write bake metrics"): return
	file.store_string(JSON.stringify(metrics) + "\n"); file.close()
	print("G71_TERRAIN3D_BIOME_BAKE=" + JSON.stringify(metrics)); print("NE_G71_TERRAIN3D_BIOME_OK"); quit(0)
