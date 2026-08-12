extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g07-relief-probe.json"
const EXPECTED_POLICY := "gunbatimi-ustasi-g07-terrain3d-relief-2026-08-12-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_HEIGHT_ERROR := 0.00002

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G07 Terrain3D relief proof failed: " + message)
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
	return lerpf(lerpf(float(rows[y0][x0]), float(rows[y0][x1]), tx), lerpf(float(rows[y1][x0]), float(rows[y1][x1]), tx), ty)

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

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "G07 relief probe missing"):
		return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON did not decode to Dictionary"):
		return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected G07 relief policy"):
		return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "owner-map SHA changed"):
		return
	if not _require(int(probe["terrain3dRegionSize"]) == 256, "proof must use Terrain3D region size 256"):
		return

	var terrain := Terrain3D.new()
	terrain.name = "G07Terrain3DReliefProof"
	get_root().add_child(terrain)
	terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"):
		return

	var height_image := _build_height_image(probe)
	var min_source := INF
	var max_source := -INF
	for z in 256:
		for x in 256:
			var h := height_image.get_pixel(x, z).r
			min_source = minf(min_source, h)
			max_source = maxf(max_source, h)
	if not _require(max_source < float(probe["waterCeilingMeters"]), "G07 seabed relief crossed the marine ceiling"):
		return
	if not _require(max_source - min_source > 0.5, "G07 relief image is effectively flat"):
		return

	terrain.data.import_images([height_image, null, null], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 1, "Terrain3D relief import produced no region"):
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
				_fail("Terrain3D returned NaN for imported G07 relief")
				return
			var expected := height_image.get_pixel(x, z).r
			max_error = maxf(max_error, absf(actual - expected))
			var quantized := int(round((actual + 16.0) * 100000.0))
			output_checksum = int((output_checksum ^ quantized) * 16777619) & 0xffffffff
			sample_count += 1
	if not _require(max_error <= MAX_HEIGHT_ERROR, "Terrain3D relief round-trip drift exceeded tolerance"):
		return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "Terrain3D LOD0 relief bake returned no mesh"):
		return
	var arrays := baked_mesh.surface_get_arrays(0)
	var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "Terrain3D LOD0 relief bake returned no vertices"):
		return

	var suffix := OS.get_environment("G07_RELIEF_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var output_dir := "user://g07-terrain3d-relief-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	terrain.data.save_directory(output_dir)
	var saved := _saved_region_evidence(output_dir)
	if not _require(saved["files"].size() >= 1 and int(saved["totalBytes"]) > 0, "Terrain3D relief region was not persisted"):
		return

	var metrics := {
		"terrain3dVersion": String(terrain.version),
		"regionSize": int(terrain.region_size),
		"regionCount": terrain.data.get_region_count(),
		"sampleCount": sample_count,
		"maxHeightError": snappedf(max_error, 0.00000001),
		"sourceHeightSpan": snappedf(max_source - min_source, 0.00000001),
		"outputChecksum": output_checksum,
		"bakedSurfaces": baked_mesh.get_surface_count(),
		"bakedVertices": vertices.size(),
		"savedRegionFiles": saved["files"].size(),
		"savedRegionBytes": int(saved["totalBytes"]),
	}
	print("G07_TERRAIN3D_RELIEF_METRICS=" + JSON.stringify(metrics))
	print("SW_G07_TERRAIN3D_RELIEF_VALIDATION_OK")
	quit(0)
