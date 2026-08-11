extends SceneTree

const AUTHORING_SCENE := "res://scenes/westeros_terrain_authoring.tscn"


func _init() -> void:
	call_deferred("_run_validation")


func _fail(message: String) -> void:
	push_error(message)
	quit(1)


func _run_validation() -> void:
	var packed := load(AUTHORING_SCENE) as PackedScene
	if packed == null:
		_fail("Terrain polish scene could not be loaded")
		return

	var root := packed.instantiate()
	if not root.has_method("ensure_authoring_ready"):
		_fail("Terrain authoring bootstrap contract is missing")
		return

	if not root.call("ensure_authoring_ready"):
		_fail("Terrain authoring bootstrap failed")
		return

	get_root().add_child(root)
	var terrain = root.get_node_or_null("HTerrain")
	if terrain == null:
		_fail("HTerrain node is missing")
		return

	var reduction = terrain.get_shader_param("u_tile_reduction")
	if not reduction is Vector4:
		_fail("u_tile_reduction did not resolve to Vector4: %s" % [reduction])
		return
	if not is_equal_approx(reduction.x, 1.0) or not is_zero_approx(reduction.y) or not is_zero_approx(reduction.z) or not is_zero_approx(reduction.w):
		_fail("Iteration #01 tiling reduction regressed: %s" % [reduction])
		return

	var specular = terrain.get_shader_param("u_specular")
	if not specular is float:
		_fail("u_specular did not resolve to float: %s" % [specular])
		return
	if not is_equal_approx(specular, 0.25):
		_fail("Starter terrain specular must be 0.25 in Iteration #02: %s" % [specular])
		return

	print("TERRAIN_POLISH_ITERATION_02_OK specular=%.2f tile_reduction=%s" % [specular, reduction])
	root.queue_free()
	quit(0)
