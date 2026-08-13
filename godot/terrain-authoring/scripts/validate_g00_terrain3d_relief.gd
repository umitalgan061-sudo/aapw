extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g00-relief-probe.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g00-relief-imported-topdown.png"
const EXPECTED_POLICY := "buzul-muhafizi-g00-terrain3d-relief-2026-08-13-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_HEIGHT_ERROR := 0.00002

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G00 Terrain3D relief proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _source_height(probe: Dictionary, u: float, v: float) -> float:
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
	var top := lerpf(float(rows[y0][x0]), float(rows[y0][x1]), tx)
	var bottom := lerpf(float(rows[y1][x0]), float(rows[y1][x1]), tx)
	return lerpf(top, bottom, ty)

func _build_height_image(probe: Dictionary) -> Image:
	var region_size := int(probe["terrain3dRegionSize"])
	var image := Image.create_empty(region_size, region_size, false, Image.FORMAT_RF)
	for z in region_size:
		var v := float(z) / float(region_size - 1)
		for x in region_size:
			var u := float(x) / float(region_size - 1)
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
			var deep := Color(0.08, 0.17, 0.23)
			var shore := Color(0.31, 0.39, 0.36)
			var snow := Color(0.82, 0.88, 0.89)
			var color := deep.lerp(shore, clampf(t * 2.0, 0.0, 1.0)) if t < 0.5 else shore.lerp(snow, (t - 0.5) * 2.0)
			preview.set_pixel(x, z, color)
	var absolute := ProjectSettings.globalize_path(PREVIEW_PATH)
	DirAccess.make_dir_recursive_absolute(absolute.get_base_dir())
	return preview.save_png(PREVIEW_PATH) == OK

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "G00 relief probe JSON missing"):
		return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON did not decode to Dictionary"):
		return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected G00 relief policy"):
		return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "owner-map SHA changed"):
		return
	if not _require(int(probe["terrain3dRegionSize"]) == 256, "proof must use Terrain3D region size 256"):
		return
	if not _require(float(probe["worldWidthMeters"]) > 13000.0 and float(probe["worldDepthMeters"]) > 10000.0, "physical normal scale is not full-reference extent"):
		return
	if not _require(int(probe["canonicalWaterCells"]) == 60 and int(probe["canonicalLandCells"]) == 36, "G00 hydrology fingerprint changed"):
		return
	if not _require(int(probe["canonicalSignMismatches"]) == 0, "relief moved canonical water/land semantics"):
		return

	var terrain := Terrain3D.new()
	terrain.name = "G00Terrain3DReliefProof"
	get_root().add_child(terrain)
	terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"):
		return
	var height_image := _build_height_image(probe)
	terrain.data.import_images([height_image, null, null], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() == 1, "Terrain3D relief import must produce exactly one 256 region"):
		return

	var max_error := 0.0
	var min_imported := INF
	var max_imported := -INF
	var output_checksum: int = 2166136261
	var sample_count := 0
	for z in range(0, 256, 16):
		for x in range(0, 256, 16):
			var actual := terrain.data.get_height(Vector3(float(x), 0.0, float(z)))
			if is_nan(actual):
				_fail("Terrain3D returned NaN for imported G00 relief")
				return
			var expected := height_image.get_pixel(x, z).r
			max_error = maxf(max_error, absf(actual - expected))
			min_imported = minf(min_imported, actual)
			max_imported = maxf(max_imported, actual)
			output_checksum = int((output_checksum ^ int(round((actual + 128.0) * 1000.0))) * 16777619) & 0xffffffff
			sample_count += 1
	if not _require(max_error <= MAX_HEIGHT_ERROR, "Terrain3D height roundtrip exceeded tolerance"):
		return
	if not _require(min_imported < 0.0 and max_imported > 3.0, "Terrain3D relief lost G00 coast/land height character"):
		return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "Terrain3D LOD0 relief bake returned no mesh"):
		return
	var arrays := baked_mesh.surface_get_arrays(0)
	var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "Terrain3D LOD0 relief bake returned no vertices"):
		return

	var suffix := OS.get_environment("G00_RELIEF_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var output_dir := "user://g00-terrain3d-relief-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	terrain.data.save_directory(output_dir)
	var saved := _saved_region_evidence(output_dir)
	if not _require(saved["files"].size() >= 1 and int(saved["totalBytes"]) > 0, "Terrain3D relief region resource was not persisted"):
		return
	if not _require(_write_preview(terrain, float(probe["minHeight"]), float(probe["maxHeight"])), "failed to write imported top-down evidence"):
		return

	var metrics := {
		"terrain3dVersion": String(terrain.version),
		"regionSize": int(terrain.region_size),
		"regionCount": terrain.data.get_region_count(),
		"sampleCount": sample_count,
		"maxHeightError": snappedf(max_error, 0.00000001),
		"minImportedHeight": snappedf(min_imported, 0.000001),
		"maxImportedHeight": snappedf(max_imported, 0.000001),
		"outputChecksum": output_checksum,
		"bakedSurfaces": baked_mesh.get_surface_count(),
		"bakedVertices": vertices.size(),
		"savedRegionFiles": saved["files"].size(),
		"savedRegionBytes": int(saved["totalBytes"]),
		"previewPath": PREVIEW_PATH,
	}
	print("G00_TERRAIN3D_RELIEF_METRICS=" + JSON.stringify(metrics))
	print("NW_G00_TERRAIN3D_RELIEF_VALIDATION_OK")
	quit(0)
