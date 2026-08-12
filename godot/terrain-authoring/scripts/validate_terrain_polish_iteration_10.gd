extends SceneTree

const PROBE_DIRECTORY := "res://terrain_polish_probe_007"
const RESOLUTION := 513
const CENTER := Vector2i(256, 256)
const OUTSIDE := Vector2i(32, 32)


func _init() -> void:
	call_deferred("_run_validation")


func _fail(message: String) -> void:
	push_error(message)
	quit(1)


func _run_validation() -> void:
	var detail_path := PROBE_DIRECTORY.path_join("detail.png")
	var splat_path := PROBE_DIRECTORY.path_join("splat.png")
	var detail_image := Image.load_from_file(ProjectSettings.globalize_path(detail_path))
	var splat_image := Image.load_from_file(ProjectSettings.globalize_path(splat_path))
	if detail_image == null or detail_image.is_empty():
		_fail("Persisted authored detail mask could not be loaded")
		return
	if splat_image == null or splat_image.is_empty():
		_fail("Persisted authored splat map could not be loaded")
		return
	if detail_image.get_size() != Vector2i(RESOLUTION, RESOLUTION):
		_fail("Persisted authored detail resolution drifted: %s" % detail_image.get_size())
		return
	if splat_image.get_size() != Vector2i(RESOLUTION, RESOLUTION):
		_fail("Persisted authored splat resolution drifted: %s" % splat_image.get_size())
		return

	detail_image.convert(Image.FORMAT_L8)
	var outside_density := detail_image.get_pixelv(OUTSIDE).r
	if outside_density > 0.001:
		_fail("Authored grass detail leaked outside the bounded authored region: %s" % outside_density)
		return

	var center_splat := splat_image.get_pixelv(CENTER)
	var center_density := detail_image.get_pixelv(CENTER).r
	if center_splat.b < 0.50:
		_fail("Authored probe center rock contract drifted before detail validation: %s" % center_splat.b)
		return
	if center_density > 0.30:
		_fail("Rock-heavy authored center retained too much grass density: %s" % center_density)
		return

	var nonzero_cells := 0
	var grass_dominant_cells := 0
	var rock_heavy_cells := 0
	var rock_heavy_density_sum := 0.0
	var grass_dominant_density_sum := 0.0
	var max_density := 0.0
	for y in range(RESOLUTION):
		for x in range(RESOLUTION):
			var density := detail_image.get_pixel(x, y).r
			var splat := splat_image.get_pixel(x, y)
			max_density = maxf(max_density, density)
			if density > 0.001:
				nonzero_cells += 1
			if splat.r >= 0.65 and splat.g + splat.b > 0.02:
				grass_dominant_cells += 1
				grass_dominant_density_sum += density
			if splat.b >= 0.50:
				rock_heavy_cells += 1
				rock_heavy_density_sum += density

	if nonzero_cells < 20000:
		_fail("Persisted authored detail mask populated too few cells: %s" % nonzero_cells)
		return
	if grass_dominant_cells < 1000 or rock_heavy_cells < 100:
		_fail("Authored detail validation samples are too small: grass=%s rock=%s" % [grass_dominant_cells, rock_heavy_cells])
		return
	var grass_mean := grass_dominant_density_sum / float(grass_dominant_cells)
	var rock_mean := rock_heavy_density_sum / float(rock_heavy_cells)
	if grass_mean <= rock_mean + 0.08:
		_fail("Grass-dominant density is not meaningfully above rock-heavy density: grass=%s rock=%s" % [grass_mean, rock_mean])
		return
	if max_density < 0.20:
		_fail("Persisted authored detail mask is effectively empty: max=%s" % max_density)
		return

	print("TERRAIN_POLISH_ITERATION_10_OK nonzero_cells=%s center_density=%.6f grass_mean=%.6f rock_mean=%.6f max_density=%.6f" % [
		nonzero_cells,
		center_density,
		grass_mean,
		rock_mean,
		max_density,
	])
	quit(0)
