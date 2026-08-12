extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g07-road-path-probe.json"
const EXPECTED_POLICY := "gunbatimi-ustasi-g07-terrain3d-road-path-2026-08-13-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G07 Terrain3D road/path proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _build_height_image(size: int) -> Image:
	var image := Image.create_empty(size, size, false, Image.FORMAT_RF)
	image.fill(Color(-8.0, 0.0, 0.0, 1.0))
	return image

func _build_control_image(probe: Dictionary) -> Image:
	var size := int(probe["terrain3dRegionSize"])
	var base_id := int(probe["baseTextureId"])
	var road_id := int(probe["roadTextureId"])
	var image := Image.create_empty(size, size, false, Image.FORMAT_RF)
	var bits: int = Terrain3DUtil.enc_base(base_id) | Terrain3DUtil.enc_overlay(road_id) | Terrain3DUtil.enc_blend(0)
	var encoded := Terrain3DUtil.as_float(bits)
	for z in size:
		for x in size:
			image.set_pixel(x, z, Color(encoded, 0.0, 0.0, 1.0))
	return image

func _write_topdown(terrain: Terrain3D, size: int) -> Error:
	var image := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var sea := Color(0.08, 0.20, 0.28, 1.0)
	var road := Color(0.62, 0.47, 0.26, 1.0)
	for z in size:
		for x in size:
			var blend := terrain.data.get_control_blend(Vector3(float(x), 0.0, float(z)))
			if is_nan(blend): blend = 0.0
			image.set_pixel(x, z, sea.lerp(road, clampf(blend, 0.0, 1.0)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	return image.save_png("res://.terrain3d-proof/g07-road-path-imported-topdown.png")

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON invalid"): return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "policy changed"): return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "map.png SHA changed"): return
	if not _require(int(probe["sourceGridSize"]) == 257, "source grid must be 257x257"): return
	if not _require(int(probe["terrain3dRegionSize"]) == 256, "Terrain3D region must be 256"): return
	if not _require((probe["crossingEdges"] as Array).is_empty(), "runtime road crossing entered G07"): return
	if not _require(int(probe["activeRoadSamples"]) == 0 and int(probe["activePathSamples"]) == 0, "open sea gained road/path coverage"): return

	var terrain := Terrain3D.new()
	terrain.name = "G07Terrain3DRoadPathProof"
	get_root().add_child(terrain)
	terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	var height := _build_height_image(256)
	var control := _build_control_image(probe)
	terrain.data.import_images([height, control, null], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 1, "real Terrain3D region was not created"): return

	var sample_count := 0
	var checksum: int = 2166136261
	for z in range(0, 256, 8):
		for x in range(0, 256, 8):
			var pos := Vector3(float(x), 0.0, float(z))
			var blend := terrain.data.get_control_blend(pos)
			if not _require(not is_nan(blend), "control blend returned NAN"): return
			if not _require(absf(blend) <= 0.000001, "Terrain3D imported non-zero road coverage into open sea"): return
			checksum = int((checksum ^ int(round(blend * 255.0))) * 16777619) & 0xffffffff
			sample_count += 1

	if not _require(_write_topdown(terrain, 256) == OK, "top-down proof could not be saved"): return
	var mesh: Mesh = terrain.bake_mesh(0)
	if not _require(mesh != null and mesh.get_surface_count() > 0, "LOD0 bake returned no mesh"): return
	var arrays := mesh.surface_get_arrays(0)
	var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "LOD0 bake returned no vertices"): return

	var suffix := OS.get_environment("G07_ROAD_PATH_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var output_dir := "user://g07-terrain3d-road-path-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	terrain.data.save_directory(output_dir)
	var dir := DirAccess.open(output_dir)
	if not _require(dir != null, "save_directory did not create output"): return
	var files := 0
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir(): files += 1
		name = dir.get_next()
	dir.list_dir_end()
	if not _require(files > 0, "no Terrain3D region resource persisted"): return

	var metrics := {"terrain3dVersion": String(terrain.version), "regionCount": terrain.data.get_region_count(), "sampleCount": sample_count, "outputChecksum": checksum, "bakedSurfaces": mesh.get_surface_count(), "bakedVertices": vertices.size(), "savedRegionFiles": files}
	print("G07_TERRAIN3D_ROAD_PATH_METRICS=" + JSON.stringify(metrics))
	print("SW_G07_TERRAIN3D_ROAD_PATH_VALIDATION_OK")
	quit(0)
