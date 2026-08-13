extends SceneTree

const SOURCE_PATH := "res://.terrain3d-proof/g17-hydrology-source.json"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const EXPECTED_HEIGHT := -4.0
const HEIGHT_EPSILON := 0.012

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error(message)
	quit(1)

func _sample(values: Array, u: float, v: float) -> float:
	var gx := clampf(u, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var gy := clampf(v, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var x0 := int(floor(gx))
	var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, SOURCE_SIZE - 1)
	var y1 := mini(y0 + 1, SOURCE_SIZE - 1)
	var tx := gx - float(x0)
	var ty := gy - float(y0)
	var top := lerpf(float(values[y0 * SOURCE_SIZE + x0]), float(values[y0 * SOURCE_SIZE + x1]), tx)
	var bottom := lerpf(float(values[y1 * SOURCE_SIZE + x0]), float(values[y1 * SOURCE_SIZE + x1]), tx)
	return lerpf(top, bottom, ty)

func _run() -> void:
	if not FileAccess.file_exists(SOURCE_PATH):
		_fail("missing G17 hydrology source")
		return
	var file := FileAccess.open(SOURCE_PATH, FileAccess.READ)
	if file == null:
		_fail("cannot open G17 hydrology source")
		return
	var source = JSON.parse_string(file.get_as_text())
	file.close()
	if not source is Dictionary or String(source.get("schema", "")) != "westeros-g17-hydrology-v1":
		_fail("bad G17 hydrology source schema")
		return
	var canonical: Dictionary = source.get("canonical", {})
	if int(canonical.get("water", -1)) != 96 or int(canonical.get("land", -1)) != 0:
		_fail("G17 canonical water/land fingerprint drift")
		return
	if int(canonical.get("sea", -1)) != 96 or int(canonical.get("lake", -1)) != 0:
		_fail("G17 sea/lake fingerprint drift")
		return
	var guard: Dictionary = source.get("guard", {})
	if int(guard.get("samples", -1)) != 126 or int(guard.get("sea", -1)) != 126:
		_fail("G17 guard-band sea fingerprint drift")
		return
	var heights: Array = source.get("heights", [])
	if heights.size() != SOURCE_SIZE * SOURCE_SIZE:
		_fail("bad G17 hydrology height channel")
		return
	for value in heights:
		if absf(float(value) - EXPECTED_HEIGHT) > 0.000001:
			_fail("G17 Coast/Hydrology source must remain a constant open-sea proof plane")
			return

	var height_image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			height_image.set_pixel(x, z, Color(_sample(heights, float(x) / 256.0, float(z) / 256.0), 0.0, 0.0, 1.0))

	var terrain := Terrain3D.new()
	get_root().add_child(terrain)
	terrain.region_size = 256
	if not String(terrain.version).begins_with("1.0.2"):
		_fail("wrong Terrain3D version")
		return
	terrain.data.import_images([height_image, null, null], Vector3.ZERO, 0.0, 1.0)
	var region_count := terrain.data.get_region_count()
	if region_count < 4:
		_fail("G17 guard-backed import needs at least four Terrain3D regions")
		return

	var max_height_error := 0.0
	var min_imported_height := INF
	var max_imported_height := -INF
	for y in SOURCE_SIZE:
		for x in SOURCE_SIZE:
			var point := Vector3(float(x * 4), 0.0, float(y * 4))
			var actual := terrain.data.get_height(point)
			if is_nan(actual):
				_fail("NAN G17 imported height")
				return
			var expected := _sample(heights, float(x) / 64.0, float(y) / 64.0)
			max_height_error = maxf(max_height_error, absf(actual - expected))
			min_imported_height = minf(min_imported_height, actual)
			max_imported_height = maxf(max_imported_height, actual)
	if max_height_error > HEIGHT_EPSILON:
		_fail("G17 height parity exceeded tolerance")
		return
	if min_imported_height < EXPECTED_HEIGHT - HEIGHT_EPSILON or max_imported_height > EXPECTED_HEIGHT + HEIGHT_EPSILON:
		_fail("G17 imported open-sea proof plane drifted")
		return
	if max_imported_height >= 0.0:
		_fail("G17 Coast/Hydrology proof crossed sea level")
		return

	for px in [254.5, 255.0, 255.5, 256.0]:
		if is_nan(terrain.data.get_height(Vector3(px, 0.0, 255.5))):
			_fail("NAN G17 Terrain3D region seam")
			return

	var mesh: Mesh = terrain.bake_mesh(0)
	if mesh == null or mesh.get_surface_count() < 1:
		_fail("empty G17 LOD0 Terrain3D bake")
		return
	var arrays := mesh.surface_get_arrays(0)
	var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	if vertices.is_empty():
		_fail("empty G17 LOD0 Terrain3D vertices")
		return

	var suffix := OS.get_environment("G17_HYDROLOGY_PROOF_SUFFIX")
	if suffix.is_empty():
		suffix = "default"
	var save_dir := "user://g17-terrain3d-hydrology-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir))
	terrain.data.save_directory(save_dir)

	var metrics := {
		"terrain3dVersion": String(terrain.version),
		"regionCount": region_count,
		"bakedVertices": vertices.size(),
		"maxHeightError": max_height_error,
		"minImportedHeight": min_imported_height,
		"maxImportedHeight": max_imported_height,
		"guardSeaSamples": int(guard.get("sea", 0)),
	}
	print("G17_TERRAIN3D_HYDROLOGY_METRICS=" + JSON.stringify(metrics))
	print("SW_G17_TERRAIN3D_HYDROLOGY_OK")
	quit(0)
