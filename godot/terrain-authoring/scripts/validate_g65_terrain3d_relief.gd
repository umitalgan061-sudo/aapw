extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g65-relief-probe.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g65-relief-imported-topdown.png"
const EXPECTED_POLICY := "kizil-ufuk-g65-terrain3d-relief-2026-08-13-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const MAX_ALIGNED_HEIGHT_ERROR := 0.012
const MAX_SEAM_HEIGHT_ERROR := 0.02

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G65 Terrain3D relief proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _source_height(probe: Dictionary, u: float, v: float) -> float:
	var rows: Array = probe["rows"]
	var gx := clampf(u, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var gy := clampf(v, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var x0 := int(floor(gx))
	var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, SOURCE_SIZE - 1)
	var y1 := mini(y0 + 1, SOURCE_SIZE - 1)
	var tx := gx - float(x0)
	var ty := gy - float(y0)
	var top := lerpf(float(rows[y0][x0]), float(rows[y0][x1]), tx)
	var bottom := lerpf(float(rows[y1][x0]), float(rows[y1][x1]), tx)
	return lerpf(top, bottom, ty)

func _build_height_image(probe: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		var v := float(z) / float(IMPORT_SIZE - 1)
		for x in IMPORT_SIZE:
			var u := float(x) / float(IMPORT_SIZE - 1)
			image.set_pixel(x, z, Color(_source_height(probe, u, v), 0.0, 0.0, 1.0))
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
			total_bytes += FileAccess.get_file_as_bytes(directory.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end()
	files.sort()
	return {"files": files, "totalBytes": total_bytes}

func _write_preview(terrain: Terrain3D, min_height: float, max_height: float) -> bool:
	var size := 256
	var preview := Image.create_empty(size, size, false, Image.FORMAT_RGB8)
	var span := maxf(max_height - min_height, 0.0001)
	for z in size:
		for x in size:
			var height := terrain.data.get_height(Vector3(float(x), 0.0, float(z)))
			if is_nan(height):
				return false
			var t := clampf((height - min_height) / span, 0.0, 1.0)
			preview.set_pixel(x, z, Color(0.14, 0.20, 0.09).lerp(Color(0.72, 0.61, 0.37), t))
	var absolute := ProjectSettings.globalize_path(PREVIEW_PATH)
	DirAccess.make_dir_recursive_absolute(absolute.get_base_dir())
	return preview.save_png(PREVIEW_PATH) == OK

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "G65 relief probe JSON missing"):
		return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON did not decode to Dictionary"):
		return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected G65 relief policy"):
		return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "owner-map SHA changed"):
		return
	if not _require(int(probe["sourceGridSize"]) == SOURCE_SIZE, "proof must use deterministic 65x65 source"):
		return
	if not _require(int(probe["terrain3dRegionSize"]) == REGION_SIZE and int(probe["terrain3dImportSize"]) == IMPORT_SIZE, "proof must use 257 import over region_size 256"):
		return
	if not _require(float(probe["worldWidthMeters"]) > 13000.0 and float(probe["worldDepthMeters"]) > 10000.0, "physical normal scale is not full-reference extent"):
		return
	if not _require(int(probe["canonicalWaterCells"]) == 0 and int(probe["canonicalLandCells"]) == 96, "G65 dry hydrology fingerprint changed"):
		return
	if not _require(int(probe["canonicalSignMismatches"]) == 0 and float(probe["minCanonicalLandHeight"]) > 0.0, "relief moved canonical dry-land semantics"):
		return

	var height_image := _build_height_image(probe)
	var terrain := Terrain3D.new()
	terrain.name = "G65Terrain3DReliefProof"
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"):
		return
	terrain.data.import_images([height_image, null, null], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 4, "257x257 G65 relief import must create four Terrain3D regions"):
		return

	var max_aligned_error := 0.0
	var min_imported := INF
	var max_imported := -INF
	var output_checksum: int = 2166136261
	var aligned_samples := 0
	for sy in SOURCE_SIZE:
		for sx in SOURCE_SIZE:
			var px := float(sx * 4)
			var pz := float(sy * 4)
			var actual := terrain.data.get_height(Vector3(px, 0.0, pz))
			if is_nan(actual):
				_fail("Terrain3D returned NaN for aligned G65 relief")
				return
			var expected := _source_height(probe, float(sx) / 64.0, float(sy) / 64.0)
			max_aligned_error = maxf(max_aligned_error, absf(actual - expected))
			min_imported = minf(min_imported, actual)
			max_imported = maxf(max_imported, actual)
			output_checksum = int((output_checksum ^ int(round((actual + 128.0) * 1000.0))) * 16777619) & 0xffffffff
			aligned_samples += 1
	if not _require(max_aligned_error <= MAX_ALIGNED_HEIGHT_ERROR, "Terrain3D aligned height roundtrip exceeded tolerance"):
		return
	if not _require(max_imported > min_imported, "Terrain3D relief lost physical height character"):
		return

	var seam_values := [254.5, 255.0, 255.5, 256.0]
	var max_seam_error := 0.0
	var seam_samples := 0
	for z in seam_values:
		for x in seam_values:
			var actual := terrain.data.get_height(Vector3(float(x), 0.0, float(z)))
			if is_nan(actual):
				_fail("Terrain3D returned NaN across 255/256 G65 relief region seam")
				return
			var expected := _source_height(probe, float(x) / 256.0, float(z) / 256.0)
			max_seam_error = maxf(max_seam_error, absf(actual - expected))
			seam_samples += 1
	for x in seam_values:
		for z in [32.25, 96.5, 160.75, 224.5]:
			var actual_x := terrain.data.get_height(Vector3(float(x), 0.0, float(z)))
			var expected_x := _source_height(probe, float(x) / 256.0, float(z) / 256.0)
			if is_nan(actual_x):
				_fail("Terrain3D returned NaN on vertical G65 region seam")
				return
			max_seam_error = maxf(max_seam_error, absf(actual_x - expected_x))
			var actual_z := terrain.data.get_height(Vector3(float(z), 0.0, float(x)))
			var expected_z := _source_height(probe, float(z) / 256.0, float(x) / 256.0)
			if is_nan(actual_z):
				_fail("Terrain3D returned NaN on horizontal G65 region seam")
				return
			max_seam_error = maxf(max_seam_error, absf(actual_z - expected_z))
			seam_samples += 2
	if not _require(max_seam_error <= MAX_SEAM_HEIGHT_ERROR, "Terrain3D 255/256 seam roundtrip exceeded tolerance"):
		return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "Terrain3D LOD0 relief bake returned no mesh"):
		return
	var arrays := baked_mesh.surface_get_arrays(0)
	var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "Terrain3D LOD0 relief bake returned no vertices"):
		return

	var suffix := OS.get_environment("G65_RELIEF_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var output_dir := "user://g65-terrain3d-relief-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	terrain.data.save_directory(output_dir)
	var saved := _saved_region_evidence(output_dir)
	if not _require(saved["files"].size() >= 4 and int(saved["totalBytes"]) > 0, "Terrain3D relief region resources were not persisted"):
		return
	if not _require(_write_preview(terrain, float(probe["minHeight"]), float(probe["maxHeight"])), "failed to write imported G65 top-down evidence"):
		return

	var metrics := {
		"terrain3dVersion": String(terrain.version),
		"regionSize": int(terrain.region_size),
		"regionCount": terrain.data.get_region_count(),
		"alignedSamples": aligned_samples,
		"seamSamples": seam_samples,
		"maxAlignedHeightError": snappedf(max_aligned_error, 0.00000001),
		"maxSeamHeightError": snappedf(max_seam_error, 0.00000001),
		"minImportedHeight": snappedf(min_imported, 0.000001),
		"maxImportedHeight": snappedf(max_imported, 0.000001),
		"outputChecksum": output_checksum,
		"bakedSurfaces": baked_mesh.get_surface_count(),
		"bakedVertices": vertices.size(),
		"savedRegionFiles": saved["files"].size(),
		"savedRegionBytes": int(saved["totalBytes"]),
		"previewPath": PREVIEW_PATH,
	}
	print("G65_TERRAIN3D_RELIEF_METRICS=" + JSON.stringify(metrics))
	print("SE_G65_TERRAIN3D_RELIEF_VALIDATION_OK")
	quit(0)
