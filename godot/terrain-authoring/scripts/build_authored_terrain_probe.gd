extends SceneTree

const HTerrainData = preload("res://addons/zylann.hterrain/hterrain_data.gd")

const PROBE_DIRECTORY := "res://terrain_polish_probe_007"
const RESOLUTION := 513
const PRIMARY_CENTER := Vector2(256.0, 256.0)
const PRIMARY_RADIUS := 112.0
const PRIMARY_HEIGHT := 44.0
const SECONDARY_CENTER := Vector2(302.0, 220.0)
const SECONDARY_RADIUS := 62.0
const SECONDARY_HEIGHT := 12.0
const STARTER_GLOBAL_ALBEDO := Color(0.33333334, 0.4509804, 0.2509804, 1.0)


func _init() -> void:
	call_deferred("_build_probe")


func _fail(message: String) -> void:
	push_error(message)
	quit(1)


func _radial_falloff(point: Vector2, center: Vector2, radius: float) -> float:
	var distance := point.distance_to(center)
	return clampf(1.0 - distance / radius, 0.0, 1.0)


func _build_probe() -> void:
	var probe_absolute_path := ProjectSettings.globalize_path(PROBE_DIRECTORY)
	var directory_error := DirAccess.make_dir_recursive_absolute(probe_absolute_path)
	if directory_error != OK:
		_fail("Authored probe directory could not be created: %s" % directory_error)
		return

	var data = HTerrainData.new()
	data._edit_load_default()
	if data.get_resolution() != RESOLUTION:
		_fail("Authored probe resolution drifted: %s" % data.get_resolution())
		return

	if data.get_map_count(HTerrainData.CHANNEL_DETAIL) == 0:
		data._edit_add_map(HTerrainData.CHANNEL_DETAIL)
	if data.get_map_count(HTerrainData.CHANNEL_GLOBAL_ALBEDO) == 0:
		data._edit_add_map(HTerrainData.CHANNEL_GLOBAL_ALBEDO)

	var global_albedo := data.get_image(HTerrainData.CHANNEL_GLOBAL_ALBEDO)
	if global_albedo == null:
		_fail("Authored probe global albedo map could not be created")
		return
	global_albedo.fill(STARTER_GLOBAL_ALBEDO)

	var height_image := data.get_image(HTerrainData.CHANNEL_HEIGHT)
	var splat_image := data.get_image(HTerrainData.CHANNEL_SPLAT)
	var normal_image := data.get_image(HTerrainData.CHANNEL_NORMAL)
	if height_image == null or splat_image == null or normal_image == null:
		_fail("Authored probe height/splat/normal images are unavailable")
		return
	if height_image.get_format() != Image.FORMAT_RF:
		_fail("Authored probe height format must remain RF")
		return
	if splat_image.get_format() != Image.FORMAT_RGBA8:
		_fail("Authored probe splat format must remain RGBA8")
		return
	if normal_image.get_format() != Image.FORMAT_RGB8:
		_fail("Authored probe normal format must remain RGB8")
		return

	var changed_cells := 0
	var max_height := 0.0
	var min_x := maxi(0, int(PRIMARY_CENTER.x - PRIMARY_RADIUS))
	var max_x := mini(RESOLUTION - 1, int(PRIMARY_CENTER.x + PRIMARY_RADIUS))
	var min_y := maxi(0, int(PRIMARY_CENTER.y - PRIMARY_RADIUS))
	var max_y := mini(RESOLUTION - 1, int(PRIMARY_CENTER.y + PRIMARY_RADIUS))

	for y in range(min_y, max_y + 1):
		for x in range(min_x, max_x + 1):
			var point := Vector2(float(x), float(y))
			var primary := _radial_falloff(point, PRIMARY_CENTER, PRIMARY_RADIUS)
			if primary <= 0.0:
				continue
			var secondary := _radial_falloff(point, SECONDARY_CENTER, SECONDARY_RADIUS)
			var height := PRIMARY_HEIGHT * primary * primary \
				+ SECONDARY_HEIGHT * secondary * secondary
			height_image.set_pixel(x, y, Color(height, 0.0, 0.0, 1.0))
			max_height = maxf(max_height, height)

			var rock_weight := 0.55 * primary
			var earth_band := clampf(1.0 - absf(primary - 0.45) / 0.45, 0.0, 1.0)
			var earth_weight := 0.30 * earth_band
			var combined := rock_weight + earth_weight
			if combined > 0.85:
				var scale := 0.85 / combined
				rock_weight *= scale
				earth_weight *= scale
			var grass_weight := 1.0 - rock_weight - earth_weight
			splat_image.set_pixel(
				x,
				y,
				Color(grass_weight, earth_weight, rock_weight, 0.0))
			changed_cells += 1

	if changed_cells < 30000:
		_fail("Authored probe changed too few cells: %s" % changed_cells)
		return
	if max_height < 44.0 or max_height > 57.0:
		_fail("Authored probe max height is outside the bounded test range: %s" % max_height)
		return

	# Keep the authored probe's persisted normal map in sync with the authored height field.
	# This follows HTerrain's documented encoded-normal convention without touching addon core files.
	for y in range(RESOLUTION):
		var forward_y := mini(y + 1, RESOLUTION - 1)
		for x in range(RESOLUTION):
			var right_x := mini(x + 1, RESOLUTION - 1)
			var height := height_image.get_pixel(x, y).r
			var height_right := height_image.get_pixel(right_x, y).r
			var height_forward := height_image.get_pixel(x, forward_y).r
			var normal := Vector3(height - height_right, 1.0, height_forward - height).normalized()
			normal_image.set_pixel(x, y, HTerrainData.encode_normal(normal))

	data.notify_full_change()
	if not data.save_data(PROBE_DIRECTORY):
		_fail("Authored probe could not be saved to %s" % PROBE_DIRECTORY)
		return

	for file_name in ["data.hterrain", "height.res", "splat.png", "normal.png", "color.png", "detail.png", "global_albedo.png"]:
		if not FileAccess.file_exists(PROBE_DIRECTORY.path_join(file_name)):
			_fail("Authored probe output is missing: %s" % file_name)
			return

	print("TERRAIN_AUTHORED_PROBE_OK resolution=%s changed_cells=%s max_height=%.6f normal_sync=cpu_encoded directory=%s" % [
		RESOLUTION,
		changed_cells,
		max_height,
		PROBE_DIRECTORY,
	])
	quit(0)
