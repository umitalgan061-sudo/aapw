extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g01-biome-probe.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g01-biome-color.png"
const EXPECTED_POLICY := "buzul-muhafizi-g01-terrain3d-biome-2026-08-13-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_COLOR_ERROR := 0.012

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G01 Terrain3D biome proof failed: " + message)
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
	var top := Color(float(a[0]), float(a[1]), float(a[2]), 1.0).lerp(Color(float(b[0]), float(b[1]), float(b[2]), 1.0), tx)
	var bottom := Color(float(c[0]), float(c[1]), float(c[2]), 1.0).lerp(Color(float(d[0]), float(d[1]), float(d[2]), 1.0), tx)
	return top.lerp(bottom, ty)

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "probe missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe decode failed"): return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "policy drift"): return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "map provenance drift"): return
	if not _require(int(probe["sourceGridSize"]) == 65, "source grid drift"): return
	if not _require(int(probe["terrain3dRegionSize"]) == 256, "region size drift"): return

	var terrain := Terrain3D.new()
	get_root().add_child(terrain)
	terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D not loaded"): return
	var height_image := Image.create_empty(256, 256, false, Image.FORMAT_RF)
	height_image.fill(Color(12.0, 0.0, 0.0, 1.0))
	var color_image := Image.create_empty(256, 256, false, Image.FORMAT_RGBA8)
	for z in 256:
		for x in 256:
			color_image.set_pixel(x, z, _source_color(probe, float(x) / 255.0, float(z) / 255.0))
	terrain.data.import_images([height_image, null, color_image], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() == 1, "expected one Terrain3D region"): return

	var max_error := 0.0
	var sample_count := 0
	for z in range(0, 256, 16):
		for x in range(0, 256, 16):
			var expected := color_image.get_pixel(x, z)
			var actual := terrain.data.get_color(Vector3(float(x), 0.0, float(z)))
			max_error = maxf(max_error, maxf(absf(actual.r - expected.r), maxf(absf(actual.g - expected.g), absf(actual.b - expected.b))))
			sample_count += 1
	if not _require(max_error <= MAX_COLOR_ERROR, "color roundtrip tolerance exceeded"): return

	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	if not _require(terrain.data.export_image(PREVIEW_PATH, Terrain3DRegion.TYPE_COLOR) == OK, "color export failed"): return
	if not _require(FileAccess.file_exists(PREVIEW_PATH) and FileAccess.get_file_as_bytes(PREVIEW_PATH).size() > 0, "visual proof missing"): return
	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "LOD0 bake empty"): return
	var vertices: PackedVector3Array = baked_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "LOD0 vertices empty"): return

	var suffix := OS.get_environment("G01_BIOME_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var output_dir := "user://g01-terrain3d-biome-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	terrain.data.save_directory(output_dir)
	var dir := DirAccess.open(output_dir)
	if not _require(dir != null, "save directory missing"): return
	var saved_files := 0
	var saved_bytes := 0
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			saved_files += 1
			saved_bytes += FileAccess.get_file_as_bytes(output_dir.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end()
	if not _require(saved_files >= 1 and saved_bytes > 0, "region persistence empty"): return
	print("G01_TERRAIN3D_BIOME_METRICS=" + JSON.stringify({"terrain3dVersion": String(terrain.version), "regionSize": int(terrain.region_size), "regionCount": terrain.data.get_region_count(), "sampleCount": sample_count, "maxColorError": snappedf(max_error, 0.00000001), "bakedSurfaces": baked_mesh.get_surface_count(), "bakedVertices": vertices.size(), "savedRegionFiles": saved_files, "savedRegionBytes": saved_bytes}))
	print("NW_G01_TERRAIN3D_BIOME_VALIDATION_OK")
	quit(0)
