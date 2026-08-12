extends SceneTree

const HTerrainData = preload("res://addons/zylann.hterrain/hterrain_data.gd")

const INPUT_PATH := "res://.g27_source_landmask.raw"
const PROBE_DIRECTORY := "res://terrain_sw_g27_probe"
const SOURCE_WIDTH := 192
const SOURCE_HEIGHT := 128
const RESOLUTION := 513
const WATER_HEIGHT := -6.0
const LAND_HEIGHT := 0.75


func _init() -> void:
	call_deferred("_build_probe")


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


func _build_probe() -> void:
	var mask := _read_source_mask()
	if mask.is_empty():
		return

	var probe_absolute_path := ProjectSettings.globalize_path(PROBE_DIRECTORY)
	var directory_error := DirAccess.make_dir_recursive_absolute(probe_absolute_path)
	if directory_error != OK:
		_fail("G27 HTerrain probe directory could not be created: %s" % directory_error)
		return

	var data = HTerrainData.new()
	data._edit_load_default()
	if data.get_resolution() != RESOLUTION:
		_fail("G27 HTerrain probe resolution drifted: %s" % data.get_resolution())
		return

	var height_image := data.get_image(HTerrainData.CHANNEL_HEIGHT)
	if height_image == null or height_image.get_format() != Image.FORMAT_RF:
		_fail("G27 HTerrain probe height channel must be RF")
		return

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
			var height := lerpf(WATER_HEIGHT, LAND_HEIGHT, land_confidence)
			height_image.set_pixel(x, y, Color(height, 0.0, 0.0, 1.0))
			minimum_height = minf(minimum_height, height)
			maximum_height = maxf(maximum_height, height)
			if land_confidence <= 0.001:
				water_vertices += 1
			elif land_confidence >= 0.999:
				land_vertices += 1
			else:
				transition_vertices += 1

	if land_vertices <= 0 or water_vertices <= 0 or transition_vertices <= 0:
		_fail("G27 HTerrain probe did not retain land/water/coast transition vertices")
		return
	if absf(minimum_height - WATER_HEIGHT) > 0.00001:
		_fail("G27 HTerrain probe minimum height drifted: %s" % minimum_height)
		return
	if absf(maximum_height - LAND_HEIGHT) > 0.00001:
		_fail("G27 HTerrain probe maximum height drifted: %s" % maximum_height)
		return

	data.notify_full_change()
	if not data.save_data(PROBE_DIRECTORY):
		_fail("G27 HTerrain probe could not be saved")
		return
	if not FileAccess.file_exists(PROBE_DIRECTORY.path_join("height.res")):
		_fail("G27 HTerrain probe persisted height.res is missing")
		return

	print("SW_G27_HTERRAIN_PROBE_OK resolution=%s land_vertices=%s water_vertices=%s transition_vertices=%s min_height=%.6f max_height=%.6f" % [
		RESOLUTION,
		land_vertices,
		water_vertices,
		transition_vertices,
		minimum_height,
		maximum_height,
	])
	quit(0)
