extends SceneTree

const PROBE_DIRECTORY := "res://terrain_polish_probe_007"
const RESOLUTION := 513
const DEFAULT_GRASS := Color(1.0, 0.0, 0.0, 0.0)
const WHITE := Color(1.0, 1.0, 1.0, 1.0)
const GRASS_TINT := Color(0.94, 1.0, 0.92, 1.0)
const EARTH_TINT := Color(0.91, 0.83, 0.73, 1.0)
const ROCK_TINT := Color(0.80, 0.82, 0.86, 1.0)


func _init() -> void:
	call_deferred("_apply_colormap")


func _fail(message: String) -> void:
	push_error(message)
	quit(1)


func _color_delta(left: Color, right: Color) -> float:
	return maxf(
		maxf(absf(left.r - right.r), absf(left.g - right.g)),
		maxf(absf(left.b - right.b), absf(left.a - right.a))
	)


func _is_authored_splat(splat: Color) -> bool:
	return absf(splat.r - DEFAULT_GRASS.r) > 0.004 \
		or splat.g > 0.004 \
		or splat.b > 0.004 \
		or splat.a > 0.004


func _apply_colormap() -> void:
	var color_path := PROBE_DIRECTORY.path_join("color.png")
	var splat_path := PROBE_DIRECTORY.path_join("splat.png")
	var color_image := Image.load_from_file(ProjectSettings.globalize_path(color_path))
	var splat_image := Image.load_from_file(ProjectSettings.globalize_path(splat_path))
	if color_image == null or color_image.is_empty():
		_fail("Authored probe color map could not be loaded")
		return
	if splat_image == null or splat_image.is_empty():
		_fail("Authored probe splat map could not be loaded")
		return
	if color_image.get_size() != Vector2i(RESOLUTION, RESOLUTION):
		_fail("Authored probe color map resolution drifted: %s" % color_image.get_size())
		return
	if splat_image.get_size() != Vector2i(RESOLUTION, RESOLUTION):
		_fail("Authored probe splat map resolution drifted: %s" % splat_image.get_size())
		return
	if color_image.get_format() != Image.FORMAT_RGBA8:
		_fail("Authored probe color map format must remain RGBA8")
		return
	if splat_image.get_format() != Image.FORMAT_RGBA8:
		_fail("Authored probe splat map format must remain RGBA8")
		return

	var changed_cells := 0
	var red_sum := 0.0
	var green_sum := 0.0
	var blue_sum := 0.0
	for y in range(RESOLUTION):
		for x in range(RESOLUTION):
			var splat := splat_image.get_pixel(x, y)
			if not _is_authored_splat(splat):
				continue
			var weight_sum := splat.r + splat.g + splat.b
			if weight_sum <= 0.0001:
				continue
			var grass_weight := splat.r / weight_sum
			var earth_weight := splat.g / weight_sum
			var rock_weight := splat.b / weight_sum
			var tint := Color(
				GRASS_TINT.r * grass_weight + EARTH_TINT.r * earth_weight + ROCK_TINT.r * rock_weight,
				GRASS_TINT.g * grass_weight + EARTH_TINT.g * earth_weight + ROCK_TINT.g * rock_weight,
				GRASS_TINT.b * grass_weight + EARTH_TINT.b * earth_weight + ROCK_TINT.b * rock_weight,
				1.0
			)
			color_image.set_pixel(x, y, tint)
			changed_cells += 1
			red_sum += tint.r
			green_sum += tint.g
			blue_sum += tint.b

	if changed_cells < 30000:
		_fail("Authored colormap changed too few cells: %s" % changed_cells)
		return
	if _color_delta(color_image.get_pixel(32, 32), WHITE) > 0.01:
		_fail("Authored colormap leaked outside the bounded splat region: %s" % color_image.get_pixel(32, 32))
		return

	var save_error := color_image.save_png(ProjectSettings.globalize_path(color_path))
	if save_error != OK:
		_fail("Authored colormap could not be persisted: %s" % save_error)
		return

	print("TERRAIN_AUTHORED_COLORMAP_OK changed_cells=%s mean_rgb=(%.6f,%.6f,%.6f) center=%s edge=%s" % [
		changed_cells,
		red_sum / changed_cells,
		green_sum / changed_cells,
		blue_sum / changed_cells,
		color_image.get_pixel(256, 256),
		color_image.get_pixel(32, 32),
	])
	quit(0)
