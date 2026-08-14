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
	if not specular is float or not is_equal_approx(specular, 0.25):
		_fail("Iteration #02 specular regressed: %s" % [specular])
		return

	var detail_layer = terrain.get_node_or_null("GrassDetailLayer")
	if detail_layer == null:
		_fail("GrassDetailLayer is missing")
		return

	var bottom_ao = detail_layer.get("shader_params/u_bottom_ao")
	if not bottom_ao is float or not is_equal_approx(bottom_ao, 0.35):
		_fail("Iteration #03 bottom AO regressed: %s" % [bottom_ao])
		return

	var tint_bottom = detail_layer.get("shader_params/u_globalmap_tint_bottom")
	var tint_top = detail_layer.get("shader_params/u_globalmap_tint_top")
	if not tint_bottom is float or not is_equal_approx(tint_bottom, 0.22):
		_fail("Grass global-map bottom tint must be 0.22 in Iteration #04: %s" % [tint_bottom])
		return
	if not tint_top is float or not is_equal_approx(tint_top, 0.08):
		_fail("Grass global-map top tint must be 0.08 in Iteration #04: %s" % [tint_top])
		return
	if tint_bottom <= tint_top:
		_fail("Grass root tint must remain stronger than tip tint")
		return

	if not is_equal_approx(float(detail_layer.get("density")), 4.0):
		_fail("Grass density changed unexpectedly")
		return
	if not is_equal_approx(float(detail_layer.get("view_distance")), 120.0):
		_fail("Grass view distance changed unexpectedly")
		return
	if not bool(detail_layer.get("fixed_seed_enabled")) or int(detail_layer.get("fixed_seed")) != 20260811:
		_fail("Grass determinism contract changed unexpectedly")
		return

	print("TERRAIN_POLISH_ITERATION_04_OK tint_bottom=%.2f tint_top=%.2f bottom_ao=%.2f specular=%.2f tile_reduction=%s" % [tint_bottom, tint_top, bottom_ao, specular, reduction])
	root.queue_free()
	quit(0)
