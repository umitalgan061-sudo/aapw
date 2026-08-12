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


func _read_map_image(data, channel: int) -> Image:
	var image: Image = data.get_image(channel)
	if image != null and not image.is_empty():
		return image
	var texture: Texture2D = data.get_texture(channel)
	if texture == null:
		return null
	return texture.get_image()


func _color_close(a: Color, b: Color, tolerance := 2.0 / 255.0) -> bool:
	return absf(a.r - b.r) <= tolerance \
		and absf(a.g - b.g) <= tolerance \
		and absf(a.b - b.b) <= tolerance


func _sample(image: Image, normalized: Vector2) -> Color:
	var x := clampi(roundi(normalized.x * float(image.get_width() - 1)), 0, image.get_width() - 1)
	var y := clampi(roundi(normalized.y * float(image.get_height() - 1)), 0, image.get_height() - 1)
	return image.get_pixel(x, y)


func _run_validation() -> void:
	var packed := load(AUTHORING_SCENE) as PackedScene
	if packed == null:
		_fail("Terrain polish scene could not be loaded")
		return

	var root := packed.instantiate()
	if not root.call("ensure_authoring_ready"):
		_fail("Terrain authoring bootstrap failed")
		return
	get_root().add_child(root)

	var terrain = root.get_node_or_null("HTerrain")
	if terrain == null:
		_fail("HTerrain node is missing")
		return
	var data = terrain.get_data()
	if data == null or data.get_resolution() != 513:
		_fail("Starter HTerrain data is missing or resolution drifted")
		return

	var color_map := _read_map_image(data, HTerrainData.CHANNEL_COLOR)
	var global_map := _read_map_image(data, HTerrainData.CHANNEL_GLOBAL_ALBEDO)
	if color_map == null or global_map == null:
		_fail("Iteration #07 requires readable color and global albedo maps")
		return
	if color_map.get_format() != Image.FORMAT_RGBA8:
		_fail("Starter color map format drifted: %s" % color_map.get_format())
		return
	if global_map.get_format() != Image.FORMAT_RGB8:
		_fail("Starter global albedo format drifted: %s" % global_map.get_format())
		return

	var corner := _sample(color_map, Vector2(0.0, 0.0))
	var cool := _sample(color_map, Vector2(0.28, 0.34))
	var warm := _sample(color_map, Vector2(0.70, 0.62))
	if corner.r < 0.99 or corner.g < 0.99 or corner.b < 0.99:
		_fail("Macro tint should leave far corners nearly neutral: %s" % corner)
		return
	if cool.r >= 0.98 or cool.r >= corner.r - 0.015:
		_fail("Cool macro patch is not measurably darker than neutral starter tint: %s" % cool)
		return
	if warm.b >= warm.r or warm.b >= corner.b - 0.015:
		_fail("Warm macro patch lacks the intended subtle warm-channel separation: %s" % warm)
		return
	if cool.r < 0.94 - 1.0 / 255.0 or cool.g < 0.94 - 1.0 / 255.0 or cool.b < 0.94 - 1.0 / 255.0:
		_fail("Macro tint exceeded the conservative 6 percent darkening floor: %s" % cool)
		return

	for point in [Vector2(0.0, 0.0), Vector2(0.28, 0.34), Vector2(0.70, 0.62), Vector2(0.48, 0.82)]:
		var tint := _sample(color_map, point)
		var global_sample := _sample(global_map, point)
		var expected := Color(
			STARTER_GLOBAL_ALBEDO.r * tint.r,
			STARTER_GLOBAL_ALBEDO.g * tint.g,
			STARTER_GLOBAL_ALBEDO.b * tint.b,
			1.0)
		if not _color_close(global_sample, expected):
			_fail("Global albedo is not correlated with starter macro tint at %s: actual=%s expected=%s" % [point, global_sample, expected])
			return

	var persisted_color := Image.load_from_file(ProjectSettings.globalize_path(DATA_DIRECTORY.path_join("color.png")))
	var persisted_global := Image.load_from_file(ProjectSettings.globalize_path(DATA_DIRECTORY.path_join("global_albedo.png")))
	if persisted_color == null or persisted_color.is_empty() or persisted_global == null or persisted_global.is_empty():
		_fail("Macro tint source PNGs were not persisted")
		return
	for point in [Vector2(0.28, 0.34), Vector2(0.70, 0.62)]:
		if not _color_close(_sample(persisted_color, point), _sample(color_map, point)):
			_fail("Persisted color map does not round-trip active macro tint at %s" % point)
			return
		if not _color_close(_sample(persisted_global, point), _sample(global_map, point)):
			_fail("Persisted global map does not round-trip active macro tint at %s" % point)
			return

	var color_bytes_before := FileAccess.get_file_as_bytes(DATA_DIRECTORY.path_join("color.png"))
	var global_bytes_before := FileAccess.get_file_as_bytes(DATA_DIRECTORY.path_join("global_albedo.png"))
	root.queue_free()
	await process_frame

	var second_root := packed.instantiate()
	if not second_root.call("ensure_authoring_ready"):
		_fail("Existing Terrain Data failed to reopen")
		return
	get_root().add_child(second_root)
	var color_bytes_after := FileAccess.get_file_as_bytes(DATA_DIRECTORY.path_join("color.png"))
	var global_bytes_after := FileAccess.get_file_as_bytes(DATA_DIRECTORY.path_join("global_albedo.png"))
	if color_bytes_before != color_bytes_after or global_bytes_before != global_bytes_after:
		_fail("Iteration #07 must not rewrite macro tint maps when existing Terrain Data is reopened")
		return

	var second_terrain = second_root.get_node_or_null("HTerrain")
	var detail_layer = second_terrain.get_node_or_null("GrassDetailLayer") if second_terrain != null else null
	if detail_layer == null:
		_fail("GrassDetailLayer is missing after Terrain Data reopen")
		return
	if not is_equal_approx(float(detail_layer.get("shader_params/u_globalmap_tint_bottom")), 0.22) \
	or not is_equal_approx(float(detail_layer.get("shader_params/u_globalmap_tint_top")), 0.08) \
	or not is_equal_approx(float(detail_layer.get("shader_params/u_bottom_ao")), 0.35):
		_fail("Previous grass tint/AO contracts regressed")
		return
	if not bool(detail_layer.get("fixed_seed_enabled")) or int(detail_layer.get("fixed_seed")) != 20260811:
		_fail("Grass deterministic seed contract regressed")
		return

	print("TERRAIN_POLISH_ITERATION_07_OK resolution=%s corner=%.3f cool=%.3f warm_rb=%.3f/%.3f existing_data_stable=true" % [
		data.get_resolution(),
		corner.r,
		cool.r,
		warm.r,
		warm.b,
	])
	second_root.queue_free()
	quit(0)
