extends SceneTree

const AUTHORING_SCENE := "res://scenes/westeros_terrain_authoring.tscn"
const EXPECTED_BLEND_START := 420.0
const EXPECTED_BLEND_DISTANCE := 0.0025

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
	var blend_start = terrain.get_shader_param("u_globalmap_blend_start")
	var blend_distance = terrain.get_shader_param("u_globalmap_blend_distance")
	if not blend_start is float or not is_equal_approx(blend_start, EXPECTED_BLEND_START):
		_fail("Global-map blend start must be %.1f: %s" % [EXPECTED_BLEND_START, blend_start])
		return
	if not blend_distance is float or not is_equal_approx(blend_distance, EXPECTED_BLEND_DISTANCE):
		_fail("Global-map blend distance factor must be %.4f: %s" % [EXPECTED_BLEND_DISTANCE, blend_distance])
		return
	var reduction = terrain.get_shader_param("u_tile_reduction")
	if not reduction is Vector4 or not is_equal_approx(reduction.x, 1.0):
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
	if not is_equal_approx(float(detail_layer.get("shader_params/u_bottom_ao")), 0.35):
		_fail("Iteration #03 grass bottom AO regressed")
		return
	if not is_equal_approx(float(detail_layer.get("shader_params/u_globalmap_tint_bottom")), 0.22) or not is_equal_approx(float(detail_layer.get("shader_params/u_globalmap_tint_top")), 0.08):
		_fail("Iteration #04 grass global-map tint regressed")
		return
	print("TERRAIN_POLISH_ITERATION_08_OK blend_start=%.1f blend_distance=%.4f" % [blend_start, blend_distance])
	root.queue_free()
	quit(0)
