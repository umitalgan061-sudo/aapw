extends SceneTree

const PROBE_DIRECTORY := "res://terrain_polish_probe_007"
const RESOLUTION := 513
const CENTER := Vector2i(256, 256)
const EDGE := Vector2i(32, 32)


func _init() -> void:
	call_deferred("_run_validation")


func _fail(message: String) -> void:
	push_error(message)
	quit(1)


func _run_validation() -> void:
	var height_path := PROBE_DIRECTORY.path_join("height.res")
	var splat_path := PROBE_DIRECTORY.path_join("splat.png")
	var height_image := ResourceLoader.load(height_path, "Image", ResourceLoader.CACHE_MODE_IGNORE) as Image
	var splat_image := Image.load_from_file(ProjectSettings.globalize_path(splat_path))
	if height_image == null:
		_fail("Persisted authored height probe could not be loaded")
		return
	if splat_image == null or splat_image.is_empty():
		_fail("Persisted authored splat probe could not be loaded")
		return
	if height_image.get_size() != Vector2i(RESOLUTION, RESOLUTION):
		_fail("Persisted authored height resolution drifted: %s" % height_image.get_size())
		return
	if splat_image.get_size() != Vector2i(RESOLUTION, RESOLUTION):
		_fail("Persisted authored splat resolution drifted: %s" % splat_image.get_size())
		return
	if height_image.get_format() != Image.FORMAT_RF:
		_fail("Persisted authored height format must remain RF")
		return
	if splat_image.get_format() != Image.FORMAT_RGBA8:
		_fail("Persisted authored splat format must remain RGBA8")
		return

	var center_height := height_image.get_pixelv(CENTER).r
	var edge_height := height_image.get_pixelv(EDGE).r
	if center_height < 44.0 or center_height > 57.0:
		_fail("Persisted authored center height is outside the bounded probe range: %s" % center_height)
		return
	if not is_zero_approx(edge_height):
		_fail("Authored probe leaked height outside its bounded edit region: %s" % edge_height)
		return

	var center_splat := splat_image.get_pixelv(CENTER)
	var edge_splat := splat_image.get_pixelv(EDGE)
	var center_sum := center_splat.r + center_splat.g + center_splat.b + center_splat.a
	if absf(center_sum - 1.0) > 0.02:
		_fail("Authored probe center splat weights no longer sum to one: %s" % center_sum)
		return
	if center_splat.b < 0.50:
		_fail("Authored probe center no longer carries the expected rock weight: %s" % center_splat.b)
		return
	if edge_splat.r < 0.99 or edge_splat.g > 0.01 or edge_splat.b > 0.01 or edge_splat.a > 0.01:
		_fail("Authored probe leaked splat painting outside its bounded edit region: %s" % edge_splat)
		return

	print("TERRAIN_POLISH_ITERATION_07_OK resolution=%s center_height=%.6f center_splat=(%.6f,%.6f,%.6f,%.6f)" % [
		RESOLUTION,
		center_height,
		center_splat.r,
		center_splat.g,
		center_splat.b,
		center_splat.a,
	])
	quit(0)
