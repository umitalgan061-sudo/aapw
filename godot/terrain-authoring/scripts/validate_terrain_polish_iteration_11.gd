extends SceneTree

const PROBE_DIRECTORY := "res://terrain_polish_probe_007"
const RESOLUTION := 513
const CENTER := Vector2i(256, 256)
const EDGE := Vector2i(32, 32)
const WHITE := Color(1.0, 1.0, 1.0, 1.0)


func _init() -> void:
	call_deferred("_run_validation")


func _fail(message: String) -> void:
	push_error(message)
	quit(1)


func _run_validation() -> void:
	var color_path := PROBE_DIRECTORY.path_join("color.png")
	var splat_path := PROBE_DIRECTORY.path_join("splat.png")
	var color_image := Image.load_from_file(ProjectSettings.globalize_path(color_path))
	var splat_image := Image.load_from_file(ProjectSettings.globalize_path(splat_path))
	if color_image == null or color_image.is_empty():
		_fail("Persisted authored color map could not be loaded")
		return
	if splat_image == null or splat_image.is_empty():
		_fail("Persisted authored splat map could not be loaded")
		return
	if color_image.get_size() != Vector2i(RESOLUTION, RESOLUTION):
		_fail("Persisted authored color resolution drifted: %s" % color_image.get_size())
		return
	if splat_image.get_size() != Vector2i(RESOLUTION, RESOLUTION):
		_fail("Persisted authored splat resolution drifted: %s" % splat_image.get_size())
		return
	if color_image.get_format() != Image.FORMAT_RGBA8:
		_fail("Persisted authored color format must remain RGBA8")
		return

	var edge_color := color_image.get_pixelv(EDGE)
	if edge_color.distance_to(WHITE) > 0.01:
		_fail("Authored colormap leaked outside bounded authored terrain: %s" % edge_color)
		return

	var center_color := color_image.get_pixelv(CENTER)
	var center_splat := splat_image.get_pixelv(CENTER)
	if center_splat.b < 0.50:
		_fail("Center no longer carries the expected rock-dominant splat: %s" % center_splat)
		return
	if center_color.distance_to(WHITE) < 0.08:
		_fail("Center colormap remains too close to starter white: %s" % center_color)
		return
	if center_color.r > 0.90 or center_color.g > 0.91 or center_color.b > 0.93:
		_fail("Rock-dominant center tint is not sufficiently bounded/darker: %s" % center_color)
		return
	if center_color.a < 0.99:
		_fail("Color-map alpha must remain opaque to avoid introducing terrain holes: %s" % center_color.a)
		return

	var changed_cells := 0
	var alpha_failures := 0
	var authored_red_sum := 0.0
	var authored_green_sum := 0.0
	var authored_blue_sum := 0.0
	for y in range(RESOLUTION):
		for x in range(RESOLUTION):
			var color := color_image.get_pixel(x, y)
			if color.a < 0.99:
				alpha_failures += 1
			if color.distance_to(WHITE) > 0.01:
				changed_cells += 1
				authored_red_sum += color.r
				authored_green_sum += color.g
				authored_blue_sum += color.b

	if alpha_failures != 0:
		_fail("Authored colormap introduced non-opaque pixels: %s" % alpha_failures)
		return
	if changed_cells < 30000 or changed_cells > 41000:
		_fail("Authored colormap changed-cell count drifted outside bounded probe range: %s" % changed_cells)
		return

	print("TERRAIN_POLISH_ITERATION_11_OK resolution=%s changed_cells=%s center=(%.6f,%.6f,%.6f,%.6f) mean_rgb=(%.6f,%.6f,%.6f)" % [
		RESOLUTION,
		changed_cells,
		center_color.r,
		center_color.g,
		center_color.b,
		center_color.a,
		authored_red_sum / changed_cells,
		authored_green_sum / changed_cells,
		authored_blue_sum / changed_cells,
	])
	quit(0)
