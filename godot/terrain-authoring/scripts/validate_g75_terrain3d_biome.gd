extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g75-biome-probe.json"
const EXPECTED_POLICY := "kizil-ufuk-g75-terrain3d-biome-2026-08-12-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_COLOR_ERROR := 0.012

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G75 Terrain3D biome proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _source_color(probe: Dictionary, u: float, v: float) -> Color:
	var rows: Array = probe["rows"]
	var size := int(probe["sourceGridSize"])
	var gx := clampf(u, 0.0, 1.0) * float(size - 1)
	var gy := clampf(v, 0.0, 1.0) * float(size - 1)
	var x0 := int(floor(gx)); var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, size - 1); var y1 := mini(y0 + 1, size - 1)
	var tx := gx - float(x0); var ty := gy - float(y0)
	var a: Array = rows[y0][x0]; var b: Array = rows[y0][x1]
	var c: Array = rows[y1][x0]; var d: Array = rows[y1][x1]
	var ca := Color(float(a[0]), float(a[1]), float(a[2]), 1.0)
	var cb := Color(float(b[0]), float(b[1]), float(b[2]), 1.0)
	var cc := Color(float(c[0]), float(c[1]), float(c[2]), 1.0)
	var cd := Color(float(d[0]), float(d[1]), float(d[2]), 1.0)
	return ca.lerp(cb, tx).lerp(cc.lerp(cd, tx), ty)

func _build_height_image(region_size: int) -> Image:
	var image := Image.create_empty(region_size, region_size, false, Image.FORMAT_RF)
	image.fill(Color(0.75, 0.0, 0.0, 1.0))
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
		_fail("Terrain3D save directory was not created")
		return {}
	var files: Array[String] = []; var total_bytes := 0
	dir.list_dir_begin(); var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			files.push_back(name)
			total_bytes += FileAccess.get_file_as_bytes(directory.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end(); files.sort()
	return {"files": files, "totalBytes": total_bytes}

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "G75 biome probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON did not decode to Dictionary"): return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected G75 biome policy"): return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "owner-map SHA changed"): return
	if not _require(int(probe["terrain3dRegionSize"]) == 256, "proof must use Terrain3D region size 256"): return

	var terrain := Terrain3D.new(); terrain.name = "G75Terrain3DBiomeProof"; get_root().add_child(terrain); terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	var height_image := _build_height_image(256); var color_image := _build_color_image(probe)
	terrain.data.import_images([height_image, null, color_image], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 1, "Terrain3D biome import produced no real region"): return

	var sample_positions: Array[int] = []
	for coordinate in range(0, 256, 16): sample_positions.push_back(coordinate)
	if sample_positions[-1] != 255: sample_positions.push_back(255)
	var max_error := 0.0; var checksum: int = 2166136261; var sample_count := 0
	for z in sample_positions:
		for x in sample_positions:
			var expected := color_image.get_pixel(x, z)
			var actual := terrain.data.get_color(Vector3(float(x), 0.0, float(z)))
			var error := maxf(absf(actual.r - expected.r), maxf(absf(actual.g - expected.g), absf(actual.b - expected.b)))
			max_error = maxf(max_error, error)
			for component in [actual.r, actual.g, actual.b]:
				var quantized := int(round(clampf(component, 0.0, 1.0) * 255.0))
				checksum = int((checksum ^ quantized) * 16777619) & 0xffffffff
			sample_count += 1
	if not _require(max_error <= MAX_COLOR_ERROR, "Terrain3D color-map roundtrip exceeded tolerance"): return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "Terrain3D LOD0 biome bake returned no mesh"): return
	var arrays := baked_mesh.surface_get_arrays(0); var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "Terrain3D LOD0 biome bake returned no vertices"): return

	var suffix := OS.get_environment("G75_BIOME_PROOF_SUFFIX"); if suffix.is_empty(): suffix = "default"
	var output_dir := "user://g75-terrain3d-biome-proof-" + suffix
	var absolute_dir := ProjectSettings.globalize_path(output_dir); DirAccess.make_dir_recursive_absolute(absolute_dir)
	terrain.data.save_directory(output_dir)
	var saved := _saved_region_evidence(output_dir)
	if not _require(saved["files"].size() >= 1 and int(saved["totalBytes"]) > 0, "Terrain3D biome region resource was not persisted"): return

	var metrics := {"terrain3dVersion":String(terrain.version),"regionSize":int(terrain.region_size),"regionCount":terrain.data.get_region_count(),"sampleCount":sample_count,"maxColorError":snappedf(max_error,0.00000001),"outputChecksum":checksum,"bakedSurfaces":baked_mesh.get_surface_count(),"bakedVertices":vertices.size(),"savedRegionFiles":saved["files"].size(),"savedRegionBytes":int(saved["totalBytes"])}
	print("G75_TERRAIN3D_BIOME_METRICS=" + JSON.stringify(metrics)); print("SE_G75_TERRAIN3D_BIOME_VALIDATION_OK"); quit(0)
