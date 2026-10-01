extends SceneTree

const PROBE_DIRECTORY := "res://terrain_polish_probe_007"
const RESOLUTION := 513
const SLOPE_FADE_LIMIT := 0.90
const AUTHORED_DELTA_START := 0.01
const AUTHORED_DELTA_FULL := 0.12


func _init() -> void:
	call_deferred("_apply_mask")


func _fail(message: String) -> void:
	push_error(message)
	quit(1)


func _smoothstep(edge0: float, edge1: float, value: float) -> float:
	var t := clampf((value - edge0) / (edge1 - edge0), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)


func _height_at(image: Image, x: int, y: int) -> float:
	return image.get_pixel(clampi(x, 0, RESOLUTION - 1), clampi(y, 0, RESOLUTION - 1)).r


func _apply_mask() -> void:
	var height_path := PROBE_DIRECTORY.path_join("height.res")
	var splat_path := PROBE_DIRECTORY.path_join("splat.png")
	var detail_path := PROBE_DIRECTORY.path_join("detail.png")
	var height_image := ResourceLoader.load(height_path, "Image", ResourceLoader.CACHE_MODE_IGNORE) as Image
	var splat_image := Image.load_from_file(ProjectSettings.globalize_path(splat_path))
	var detail_image := Image.load_from_file(ProjectSettings.globalize_path(detail_path))
	if height_image == null or splat_image == null or detail_image == null:
		_fail("Authored grass mask inputs could not be loaded")
		return
	if height_image.get_size() != Vector2i(RESOLUTION, RESOLUTION) \
	or splat_image.get_size() != Vector2i(RESOLUTION, RESOLUTION) \
	or detail_image.get_size() != Vector2i(RESOLUTION, RESOLUTION):
		_fail("Authored grass mask input resolution drifted")
		return
	if height_image.get_format() != Image.FORMAT_RF:
		_fail("Authored grass mask height input must remain RF")
		return
	if splat_image.get_format() != Image.FORMAT_RGBA8:
		_fail("Authored grass mask splat input must remain RGBA8")
		return

	detail_image.convert(Image.FORMAT_L8)
	detail_image.fill(Color(0, 0, 0))
	var nonzero_cells := 0
	var suppressed_rock_cells := 0
	var density_sum := 0.0
	var max_density := 0.0

	for y in range(RESOLUTION):
		for x in range(RESOLUTION):
			var splat := splat_image.get_pixel(x, y)
			var authored_delta := clampf(splat.g + splat.b + splat.a, 0.0, 1.0)
			if authored_delta <= AUTHORED_DELTA_START:
				continue

			var dx := 0.5 * (_height_at(height_image, x + 1, y) - _height_at(height_image, x - 1, y))
			var dz := 0.5 * (_height_at(height_image, x, y + 1) - _height_at(height_image, x, y - 1))
			var slope := sqrt(dx * dx + dz * dz)
			var slope_factor := clampf(1.0 - slope / SLOPE_FADE_LIMIT, 0.0, 1.0)
			var authored_factor := _smoothstep(AUTHORED_DELTA_START, AUTHORED_DELTA_FULL, authored_delta)
			var rock_exclusion := clampf(1.0 - splat.b, 0.0, 1.0)
			var density := clampf(splat.r * rock_exclusion * slope_factor * authored_factor, 0.0, 1.0)
			if splat.b >= 0.50 and density <= 0.30:
				suppressed_rock_cells += 1
			if density > 0.0:
				nonzero_cells += 1
				density_sum += density
				max_density = maxf(max_density, density)
			detail_image.set_pixel(x, y, Color(density, density, density, 1.0))

	if nonzero_cells < 20000:
		_fail("Authored grass mask populated too few cells: %s" % nonzero_cells)
		return
	if suppressed_rock_cells < 100:
		_fail("Authored grass mask did not suppress enough rock-heavy cells: %s" % suppressed_rock_cells)
		return
	if max_density < 0.20 or max_density > 1.0:
		_fail("Authored grass mask maximum density is outside expected range: %s" % max_density)
		return

	var save_error := detail_image.save_png(ProjectSettings.globalize_path(detail_path))
	if save_error != OK:
		_fail("Authored grass mask detail.png could not be persisted: %s" % save_error)
		return

	print("TERRAIN_AUTHORED_GRASS_DETAIL_OK nonzero_cells=%s rock_suppressed=%s mean_density=%.6f max_density=%.6f" % [
		nonzero_cells,
		suppressed_rock_cells,
		density_sum / float(nonzero_cells),
		max_density,
	])
	quit(0)
