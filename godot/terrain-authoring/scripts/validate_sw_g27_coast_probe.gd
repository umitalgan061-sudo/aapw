extends SceneTree

const INPUT_PATH := "res://.g27_source_landmask.raw"
const PROBE_DIRECTORY := "res://terrain_sw_g27_probe"
const SOURCE_WIDTH := 192
const SOURCE_HEIGHT := 128
const EXPECTED_SOURCE_LAND_PIXELS := 5042
const EXPECTED_SOURCE_WATER_PIXELS := 19534
const RESOLUTION := 513
const WATER_HEIGHT := -6.0
const LAND_HEIGHT := 0.75
const MAX_PERSISTENCE_ERROR := 0.00001


func _init() -> void:
	call_deferred("_run_validation")


func _fail(message: String) -> void:
	push_error(message)
	quit(1)


func _read_source_mask() -> PackedByteArray:
	var source_file := FileAccess.open(INPUT_PATH, FileAccess.READ)
	if source_file == null:
		_fail("G27 source land mask input could not be opened: %s" % INPUT_PATH)
		return PackedByteArray()
	var bytes := source_file.get_buffer(SOURCE_WIDTH * SOURCE_HEIGHT)
	if bytes.size() != SOURCE_WIDTH * SOURCE_HEIGHT:
		_fail("G27 source land mask input size drifted: %s" % bytes.size())
		return PackedByteArray()
	return bytes


func _land_sample(mask: PackedByteArray, x: int, y: int) -> float:
	var clamped_x := clampi(x, 0, SOURCE_WIDTH - 1)
	var clamped_y := clampi(y, 0, SOURCE_HEIGHT - 1)
	return float(mask[clamped_y * SOURCE_WIDTH + clamped_x]) / 255.0


func _sample_land_confidence(mask: PackedByteArray, grid_x: float, grid_y: float) -> float:
	var x0 := floori(grid_x)
	var y0 := floori(grid_y)
	var tx := grid_x - float(x0)
	var ty := grid_y - float(y0)
	var top := lerpf(_land_sample(mask, x0, y0), _land_sample(mask, x0 + 1, y0), tx)
	var bottom := lerpf(_land_sample(mask, x0, y0 + 1), _land_sample(mask, x0 + 1, y0 + 1), tx)
	return clampf(lerpf(top, bottom, ty), 0.0, 1.0)


func _run_validation() -> void:
	var mask := _read_source_mask()
	if mask.is_empty():
		return

	var source_land_pixels := 0
	var source_water_pixels := 0
	for value in mask:
		if value == 255:
			source_land_pixels += 1
		elif value == 0:
			source_water_pixels += 1
		else:
			_fail("G27 raw source mask contains a non-binary byte: %s" % value)
			return
	if source_land_pixels != EXPECTED_SOURCE_LAND_PIXELS:
		_fail("G27 source land-pixel count drifted: %s" % source_land_pixels)
		return
	if source_water_pixels != EXPECTED_SOURCE_WATER_PIXELS:
		_fail("G27 source water-pixel count drifted: %s" % source_water_pixels)
		return

	var height_path := PROBE_DIRECTORY.path_join("height.res")
	var height_image := ResourceLoader.load(height_path, "Image", ResourceLoader.CACHE_MODE_IGNORE) as Image
	if height_image == null:
		_fail("Persisted G27 HTerrain height probe could not be loaded")
		return
	if height_image.get_size() != Vector2i(RESOLUTION, RESOLUTION):
		_fail("Persisted G27 HTerrain height resolution drifted: %s" % height_image.get_size())
		return
	if height_image.get_format() != Image.FORMAT_RF:
		_fail("Persisted G27 HTerrain height format must remain RF")
		return

	var max_persistence_error := 0.0
	var land_vertices := 0
	var water_vertices := 0
	var transition_vertices := 0
	var minimum_height := INF
	var maximum_height := -INF

	for y in range(RESOLUTION):
		var normalized_y := float(y) / float(RESOLUTION - 1)
		var source_y := normalized_y * float(SOURCE_HEIGHT) - 0.5
		for x in range(RESOLUTION):
			var normalized_x := float(x) / float(RESOLUTION - 1)
			var source_x := normalized_x * float(SOURCE_WIDTH) - 0.5
			var land_confidence := _sample_land_confidence(mask, source_x, source_y)
			var expected_height := lerpf(WATER_HEIGHT, LAND_HEIGHT, land_confidence)
			var persisted_height := height_image.get_pixel(x, y).r
			max_persistence_error = maxf(max_persistence_error, absf(persisted_height - expected_height))
			minimum_height = minf(minimum_height, persisted_height)
			maximum_height = maxf(maximum_height, persisted_height)
			if land_confidence <= 0.001:
				water_vertices += 1
			elif land_confidence >= 0.999:
				land_vertices += 1
			else:
				transition_vertices += 1

	if max_persistence_error > MAX_PERSISTENCE_ERROR:
		_fail("G27 HTerrain persisted height drift exceeded tolerance: %.9f" % max_persistence_error)
		return
	if land_vertices <= 0 or water_vertices <= 0 or transition_vertices <= 0:
		_fail("G27 HTerrain persisted probe lost land/water/coast transition coverage")
		return
	if absf(minimum_height - WATER_HEIGHT) > MAX_PERSISTENCE_ERROR:
		_fail("Persisted G27 minimum height drifted: %s" % minimum_height)
		return
	if absf(maximum_height - LAND_HEIGHT) > MAX_PERSISTENCE_ERROR:
		_fail("Persisted G27 maximum height drifted: %s" % maximum_height)
		return

	print("SW_G27_HTERRAIN_VALIDATION_OK source_land=%s source_water=%s land_vertices=%s water_vertices=%s transition_vertices=%s max_persistence_error=%.9f min_height=%.6f max_height=%.6f" % [
		source_land_pixels,
		source_water_pixels,
		land_vertices,
		water_vertices,
		transition_vertices,
		max_persistence_error,
		minimum_height,
		maximum_height,
	])
	quit(0)
