extends SceneTree

const PROBE_DIRECTORY := "res://terrain_polish_probe_007"
const RESOLUTION := Vector2i(513, 513)
const CENTER := Vector2i(256, 256)
const EDGE := Vector2i(32, 32)
const STARTER_GLOBAL_ALBEDO := Color(0.33333334, 0.4509804, 0.2509804, 1.0)


func _init() -> void:
	call_deferred("_run_validation")


func _fail(message: String) -> void:
	push_error(message)
	quit(1)


func _run_validation() -> void:
	var path := PROBE_DIRECTORY.path_join("global_albedo.png")
	var image := Image.load_from_file(ProjectSettings.globalize_path(path))
	if image == null or image.is_empty():
		_fail("Persisted baked global albedo could not be loaded")
		return
	if image.get_size() != RESOLUTION:
		_fail("Baked global albedo resolution drifted: %s" % image.get_size())
		return
	if image.get_format() != Image.FORMAT_RGB8:
		_fail("Baked global albedo format must remain RGB8")
		return

	var center := image.get_pixelv(CENTER)
	var edge := image.get_pixelv(EDGE)
	if center.distance_to(edge) < 0.04:
		_fail("Baked global albedo lost authored splat/material variation")
		return
	if center.distance_to(STARTER_GLOBAL_ALBEDO) < 0.04:
		_fail("Baked center still matches the uniform starter global albedo")
		return

	print("TERRAIN_POLISH_ITERATION_08_OK center=(%.6f,%.6f,%.6f) edge=(%.6f,%.6f,%.6f) delta=%.6f" % [
		center.r,
		center.g,
		center.b,
		edge.r,
		edge.g,
		edge.b,
		center.distance_to(edge),
	])
	quit(0)
