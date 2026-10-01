extends SceneTree

const PROBE_DIRECTORY := "res://terrain_polish_probe_007"
const RESOLUTION := 513
const SLOPE_SAMPLE := Vector2i(200, 256)
const FLAT_SAMPLE := Vector2i(32, 32)

func _init() -> void:
	call_deferred("_run_validation")

func _fail(message: String) -> void:
	push_error(message)
	quit(1)

func _color_delta(a: Color, b: Color) -> float:
	return absf(a.r - b.r) + absf(a.g - b.g) + absf(a.b - b.b)

func _run_validation() -> void:
	var normal_path := PROBE_DIRECTORY.path_join("normal.png")
	var normal_image := Image.load_from_file(ProjectSettings.globalize_path(normal_path))
	if normal_image == null or normal_image.is_empty():
		_fail("Persisted authored normal probe could not be loaded")
		return
	if normal_image.get_size() != Vector2i(RESOLUTION, RESOLUTION):
		_fail("Persisted authored normal resolution drifted: %s" % normal_image.get_size())
		return
	if normal_image.get_format() != Image.FORMAT_RGB8:
		_fail("Persisted authored normal format must remain RGB8")
		return

	var slope_normal := normal_image.get_pixelv(SLOPE_SAMPLE)
	var flat_normal := normal_image.get_pixelv(FLAT_SAMPLE)
	var delta := _color_delta(slope_normal, flat_normal)
	if delta <= 0.08:
		_fail("Authored slope normal did not diverge from flat starter normal: delta=%s slope=%s flat=%s" % [delta, slope_normal, flat_normal])
		return

	print("TERRAIN_POLISH_ITERATION_08_OK resolution=%s slope_sample=%s flat_sample=%s normal_delta=%.6f" % [
		RESOLUTION,
		SLOPE_SAMPLE,
		FLAT_SAMPLE,
		delta,
	])
	quit(0)
