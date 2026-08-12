extends SceneTree

const AUTHORING_SCENE := "res://scenes/westeros_terrain_authoring.tscn"
const DATA_DIRECTORY := "res://terrain_data"
const HTerrainData = preload("res://addons/zylann.hterrain/hterrain_data.gd")
const STARTER_GLOBAL_ALBEDO := Color(85.0 / 255.0, 115.0 / 255.0, 64.0 / 255.0, 1.0)


func _init() -> void:
	call_deferred("_run_validation")


func _fail(message: String) -> void:
	push_error(message)
	quit(1)


func _color_matches(actual: Color, expected: Color) -> bool:
	var tolerance := 1.0 / 255.0
	return absf(actual.r - expected.r) <= tolerance \
		and absf(actual.g - expected.g) <= tolerance \
		and absf(actual.b - expected.b) <= tolerance


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

	var data = terrain.get_data()
	if data == null:
		_fail("HTerrain data is missing")
		return

	if data.get_map_count(HTerrainData.CHANNEL_GLOBAL_ALBEDO) != 1:
		_fail("Starter global albedo map must exist exactly once")
		return

	var global_image: Image = data.get_image(HTerrainData.CHANNEL_GLOBAL_ALBEDO)
	if global_image == null:
		_fail("Starter global albedo image is missing in memory")
		return
	if global_image.get_format() != Image.FORMAT_RGB8:
		_fail("Starter global albedo image must remain RGB8: %s" % global_image.get_format())
		return
	if global_image.get_width() != data.get_resolution() or global_image.get_height() != data.get_resolution():
		_fail("Starter global albedo resolution must match terrain data")
		return

	var sample_points := [
		Vector2i(0, 0),
		Vector2i(data.get_resolution() / 2, data.get_resolution() / 2),
		Vector2i(data.get_resolution() - 1, data.get_resolution() - 1),
	]
	for point in sample_points:
		var sample: Color = global_image.get_pixelv(point)
		if not _color_matches(sample, STARTER_GLOBAL_ALBEDO):
			_fail("Starter global albedo sample drifted at %s: %s" % [point, sample])
			return

	var metadata_path := DATA_DIRECTORY.path_join(HTerrainData.META_FILENAME)
	if not FileAccess.file_exists(metadata_path):
		_fail("HTerrain metadata was not persisted")
		return

	var metadata = JSON.parse_string(FileAccess.get_file_as_string(metadata_path))
	if not metadata is Dictionary:
		_fail("HTerrain metadata could not be parsed")
		return
	var maps = metadata.get("maps", [])
	if not maps is Array or maps.size() <= HTerrainData.CHANNEL_GLOBAL_ALBEDO:
		_fail("HTerrain metadata has no global albedo channel")
		return
	var persisted_global_maps = maps[HTerrainData.CHANNEL_GLOBAL_ALBEDO]
	if not persisted_global_maps is Array or persisted_global_maps.size() != 1:
		_fail("HTerrain metadata did not persist exactly one global albedo map")
		return

	var persisted_global_path := ""
	var data_dir := DirAccess.open(DATA_DIRECTORY)
	if data_dir == null:
		_fail("HTerrain data directory could not be opened")
		return
	data_dir.list_dir_begin()
	while true:
		var file_name := data_dir.get_next()
		if file_name.is_empty():
			break
		if not data_dir.current_is_dir() and file_name.begins_with("global_albedo") and file_name.ends_with(".png"):
			persisted_global_path = DATA_DIRECTORY.path_join(file_name)
			break
	data_dir.list_dir_end()
	if persisted_global_path.is_empty():
		_fail("Persisted starter global albedo PNG was not found")
		return

	var persisted_image: Image = Image.load_from_file(ProjectSettings.globalize_path(persisted_global_path))
	if persisted_image == null or persisted_image.is_empty():
		_fail("Persisted starter global albedo PNG could not be loaded")
		return
	var persisted_sample: Color = persisted_image.get_pixel(
		persisted_image.get_width() / 2,
		persisted_image.get_height() / 2)
	if not _color_matches(persisted_sample, STARTER_GLOBAL_ALBEDO):
		_fail("Persisted starter global albedo color drifted: %s" % persisted_sample)
		return

	var detail_layer = terrain.get_node_or_null("GrassDetailLayer")
	if detail_layer == null:
		_fail("GrassDetailLayer is missing")
		return
	if not is_equal_approx(float(detail_layer.get("shader_params/u_globalmap_tint_bottom")), 0.22):
		_fail("Iteration #04 bottom global-map tint regressed")
		return
	if not is_equal_approx(float(detail_layer.get("shader_params/u_globalmap_tint_top")), 0.08):
		_fail("Iteration #04 top global-map tint regressed")
		return
	if not is_equal_approx(float(detail_layer.get("shader_params/u_bottom_ao")), 0.35):
		_fail("Iteration #03 bottom AO regressed")
		return
	if not bool(detail_layer.get("fixed_seed_enabled")) or int(detail_layer.get("fixed_seed")) != 20260811:
		_fail("Grass determinism contract changed unexpectedly")
		return

	print("TERRAIN_POLISH_ITERATION_05_OK global_maps=%s resolution=%s persisted=%s tint_bottom=%.2f tint_top=%.2f" % [
		data.get_map_count(HTerrainData.CHANNEL_GLOBAL_ALBEDO),
		data.get_resolution(),
		persisted_global_path,
		float(detail_layer.get("shader_params/u_globalmap_tint_bottom")),
		float(detail_layer.get("shader_params/u_globalmap_tint_top")),
	])
	root.queue_free()
	quit(0)
