extends SceneTree

const SOURCE_PATH := "res://.terrain3d-proof/g17-biome-source.json"
const EXPECTED_SCHEMA := "westeros-g17-biome-v1"
const EXPECTED_POLICY := "gunbatimi-ustasi-g17-macro-biome-2026-08-13-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const SOURCE_VERTEX_STRIDE := 4
const MAX_HEIGHT_ERROR := 0.01
const MAX_COLOR_ERROR := 0.006
const MAX_ROUGHNESS_ERROR := 0.006
const MAX_BOUNDARY_COLOR_STEP := 0.01
const MAX_BOUNDARY_ROUGHNESS_STEP := 0.004

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G17 Terrain3D biome failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _finite(value: float) -> bool:
	return not is_nan(value) and not is_inf(value)

func _max3(a: float, b: float, c: float) -> float:
	return maxf(a, maxf(b, c))

func _source_value(source: Dictionary, u: float, v: float, column: int) -> float:
	var rows: Array = source["rows"]
	var size := int(source["sourceGridSize"])
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

func _source_color(source: Dictionary, u: float, v: float) -> Color:
	return Color(
		clampf(_source_value(source, u, v, 1), 0.0, 1.0),
		clampf(_source_value(source, u, v, 2), 0.0, 1.0),
		clampf(_source_value(source, u, v, 3), 0.0, 1.0),
		clampf(_source_value(source, u, v, 4), 0.0, 1.0)
	)

func _build_height_image(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		var v := float(z) / float(IMPORT_SIZE - 1)
		for x in IMPORT_SIZE:
			var u := float(x) / float(IMPORT_SIZE - 1)
			image.set_pixel(x, z, Color(_source_value(source, u, v, 0), 0.0, 0.0, 1.0))
	return image

func _build_color_image(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		var v := float(z) / float(IMPORT_SIZE - 1)
		for x in IMPORT_SIZE:
			var u := float(x) / float(IMPORT_SIZE - 1)
			image.set_pixel(x, z, _source_color(source, u, v))
	return image

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null:
		return {"files": 0, "bytes": 0}
	var files := 0
	var bytes := 0
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			files += 1
			bytes += FileAccess.get_file_as_bytes(directory.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end()
	return {"files": files, "bytes": bytes}

func _color_distance(a: Color, b: Color) -> float:
	return sqrt(pow(a.r - b.r, 2.0) + pow(a.g - b.g, 2.0) + pow(a.b - b.b, 2.0))

func _write_preview(terrain: Terrain3D, suffix: String) -> bool:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var pos := Vector3(float(x), 0.0, float(z))
			var color := terrain.data.get_color(pos)
			var roughness := terrain.data.get_roughness(pos)
			if not _finite(color.r) or not _finite(color.g) or not _finite(color.b) or not _finite(roughness):
				return false
			image.set_pixel(x, z, Color(color.r, color.g, color.b, clampf(roughness, 0.0, 1.0)))
	var path := "res://.terrain3d-proof/g17-biome-imported-topdown-%s.png" % suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(path).get_base_dir())
	return image.save_png(path) == OK

func _run() -> void:
	if not _require(FileAccess.file_exists(SOURCE_PATH), "source proof missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(SOURCE_PATH))
	if not _require(parsed is Dictionary, "source proof invalid"): return
	var source: Dictionary = parsed
	if not _require(String(source.get("schema", "")) == EXPECTED_SCHEMA, "source schema mismatch"): return
	if not _require(String(source.get("policyId", "")) == EXPECTED_POLICY, "source policy mismatch"): return
	if not _require(String(source.get("sourceMapSha256", "")) == EXPECTED_SOURCE_SHA, "map.png source SHA mismatch"): return
	if not _require(int(source.get("sourceGridSize", 0)) == SOURCE_SIZE, "source must be 65x65"): return
	if not _require(int(source.get("terrain3dImportSize", 0)) == IMPORT_SIZE, "Terrain3D import must be 257x257"): return
	if not _require(int(source.get("sourceVertexStride", 0)) == SOURCE_VERTEX_STRIDE, "source stride must be 4"): return
	var rows: Array = source["rows"]
	if not _require(rows.size() == SOURCE_SIZE, "source row count mismatch"): return
	for y in SOURCE_SIZE:
		var row: Array = rows[y]
		if not _require(row.size() == SOURCE_SIZE, "source column count mismatch"): return
		for x in SOURCE_SIZE:
			var sample: Array = row[x]
			if not _require(sample.size() >= 11, "source sample width mismatch"): return
			if not _require(absf(float(sample[0]) + 4.0) <= 0.00000001, "Macro Biome changed merged G17 hydrology height"): return
			if not _require(float(sample[5]) >= 0.99999999 and float(sample[6]) >= 0.99999999 and float(sample[7]) <= 0.00000001, "Macro Biome leaked terrestrial surface"): return

	var terrain := Terrain3D.new()
	terrain.name = "G17Terrain3DBiome"
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D 1.0.2 not loaded"): return
	terrain.data.import_images([_build_height_image(source), null, _build_color_image(source)], Vector3.ZERO, 0.0, 1.0)
	var region_count := terrain.data.get_region_count()
	if not _require(region_count >= 4, "257x257 Height+Color import did not create four guard-backed regions"): return

	var max_height_error := 0.0
	var max_color_error := 0.0
	var max_roughness_error := 0.0
	var color_checksum: int = 2166136261
	for y in SOURCE_SIZE:
		for x in SOURCE_SIZE:
			var pos := Vector3(float(x * SOURCE_VERTEX_STRIDE), 0.0, float(y * SOURCE_VERTEX_STRIDE))
			var expected: Array = rows[y][x]
			var actual_height := terrain.data.get_height(pos)
			var actual_color := terrain.data.get_color(pos)
			var actual_roughness := terrain.data.get_roughness(pos)
			if not _require(_finite(actual_height) and _finite(actual_color.r) and _finite(actual_color.g) and _finite(actual_color.b) and _finite(actual_roughness), "non-finite imported sample"): return
			max_height_error = maxf(max_height_error, absf(actual_height - float(expected[0])))
			max_color_error = maxf(max_color_error, _max3(absf(actual_color.r - float(expected[1])), absf(actual_color.g - float(expected[2])), absf(actual_color.b - float(expected[3]))))
			max_roughness_error = maxf(max_roughness_error, absf(actual_roughness - float(expected[4])))
			for component in [actual_color.r, actual_color.g, actual_color.b, actual_roughness]:
				color_checksum = int((color_checksum ^ int(round(clampf(component, 0.0, 1.0) * 255.0))) * 16777619) & 0xffffffff
	if not _require(max_height_error <= MAX_HEIGHT_ERROR, "height roundtrip exceeded tolerance"): return
	if not _require(max_color_error <= MAX_COLOR_ERROR, "marine color roundtrip exceeded tolerance"): return
	if not _require(max_roughness_error <= MAX_ROUGHNESS_ERROR, "macro roughness roundtrip exceeded tolerance"): return

	var max_boundary_height_step := 0.0
	var max_boundary_color_step := 0.0
	var max_boundary_roughness_step := 0.0
	for coordinate in range(0, IMPORT_SIZE, 8):
		for pair in [
			[Vector3(255.0, 0.0, float(coordinate)), Vector3(256.0, 0.0, float(coordinate))],
			[Vector3(float(coordinate), 0.0, 255.0), Vector3(float(coordinate), 0.0, 256.0)],
		]:
			var a: Vector3 = pair[0]
			var b: Vector3 = pair[1]
			var ah := terrain.data.get_height(a); var bh := terrain.data.get_height(b)
			var ac := terrain.data.get_color(a); var bc := terrain.data.get_color(b)
			var ar := terrain.data.get_roughness(a); var br := terrain.data.get_roughness(b)
			if not _require(_finite(ah) and _finite(bh) and _finite(ac.r) and _finite(bc.r) and _finite(ar) and _finite(br), "non-finite 255/256 seam sample"): return
			max_boundary_height_step = maxf(max_boundary_height_step, absf(ah - bh))
			max_boundary_color_step = maxf(max_boundary_color_step, _color_distance(ac, bc))
			max_boundary_roughness_step = maxf(max_boundary_roughness_step, absf(ar - br))
	if not _require(max_boundary_height_step <= 0.000001, "255/256 seam changed hydrology height"): return
	if not _require(max_boundary_color_step <= MAX_BOUNDARY_COLOR_STEP, "255/256 color seam too large"): return
	if not _require(max_boundary_roughness_step <= MAX_BOUNDARY_ROUGHNESS_STEP, "255/256 roughness seam too large"): return

	var mesh: Mesh = terrain.bake_mesh(0)
	if not _require(mesh != null and mesh.get_surface_count() >= 1, "empty LOD0 bake"): return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() == 263169, "unexpected four-region LOD0 vertex count %d" % vertices.size()): return

	var suffix := OS.get_environment("G17_BIOME_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var save_dir := "user://g17-terrain3d-biome-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir))
	terrain.data.save_directory(save_dir)
	var persisted := _saved_region_evidence(save_dir)
	if not _require(int(persisted["files"]) >= 4 and int(persisted["bytes"]) > 0, "four-region persistence evidence missing"): return
	if not _require(_write_preview(terrain, suffix), "failed to write imported biome top-down"): return

	var metrics := {
		"terrain3dVersion": String(terrain.version),
		"regionCount": region_count,
		"bakedVertices": vertices.size(),
		"persistedRegionFiles": int(persisted["files"]),
		"maxHeightError": max_height_error,
		"maxColorError": max_color_error,
		"maxRoughnessError": max_roughness_error,
		"maxBoundaryHeightStep": max_boundary_height_step,
		"maxBoundaryColorStep": max_boundary_color_step,
		"maxBoundaryRoughnessStep": max_boundary_roughness_step,
		"colorChecksum": color_checksum,
	}
	print("G17_TERRAIN3D_BIOME_METRICS=" + JSON.stringify(metrics))
	print("SW_G17_TERRAIN3D_BIOME_OK")
	quit(0)
