extends SceneTree

const AUTHORING_SCENE := "res://scenes/westeros_terrain_authoring.tscn"
const HTerrainData = preload("res://addons/zylann.hterrain/hterrain_data.gd")

const TEST_MIN := Vector2i(80, 80)
const TEST_SIZE := Vector2i(17, 17)
const SAMPLE := Vector2i(88, 88)


func _init() -> void:
	call_deferred("_run_validation")


func _fail(message: String) -> void:
	push_error(message)
	quit(1)


func _run_validation() -> void:
	if not Engine.is_editor_hint():
		_fail("Normal-baker proof must run with --editor")
		return

	var packed := load(AUTHORING_SCENE) as PackedScene
	if packed == null:
		_fail("HTerrain authoring scene could not be loaded for normal-baker proof")
		return

	var root := packed.instantiate()
	get_root().add_child(root)
	await process_frame
	await process_frame

	var terrain = root.get_node_or_null("HTerrain")
	if terrain == null:
		_fail("HTerrain node is missing during normal-baker proof")
		return

	var data = terrain.get_data()
	if data == null:
		_fail("HTerrain data is missing during normal-baker proof")
		return

	var baker = terrain.get("_normals_baker")
	if baker == null or not baker.is_inside_tree():
		_fail("HTerrain editor normal baker was not created")
		return

	var height_image: Image = data.get_image(HTerrainData.CHANNEL_HEIGHT)
	var normal_image: Image = data.get_image(HTerrainData.CHANNEL_NORMAL)
	if height_image == null or normal_image == null:
		_fail("HTerrain height/normal images are missing")
		return

	var before := normal_image.get_pixel(SAMPLE.x, SAMPLE.y)

	for y in range(TEST_MIN.y, TEST_MIN.y + TEST_SIZE.y):
		for x in range(TEST_MIN.x, TEST_MIN.x + TEST_SIZE.x):
			var height := float(x - TEST_MIN.x) * 2.0
			height_image.set_pixel(x, y, Color(height, 0.0, 0.0, 1.0))

	data.notify_region_change(
		Rect2(TEST_MIN.x, TEST_MIN.y, TEST_SIZE.x, TEST_SIZE.y),
		HTerrainData.CHANNEL_HEIGHT)

	for _frame in range(16):
		await process_frame

	var after := normal_image.get_pixel(SAMPLE.x, SAMPLE.y)
	var color_delta: float = absf(before.r - after.r) \
		+ absf(before.g - after.g) \
		+ absf(before.b - after.b)
	var changed: bool = color_delta > 0.1
	var expected_slope_normal: bool = after.r < 0.25 \
		and absf(after.g - 0.5) < 0.12 \
		and after.b > 0.62 \
		and after.b < 0.86

	if not changed:
		_fail("HTerrain normal baker did not update the normal map after a height edit")
		return

	if not expected_slope_normal:
		_fail("HTerrain normal baker output is not a plausible deterministic slope normal: %s" % after)
		return

	print("HTERRAIN_NORMAL_BAKER_OK before=%s after=%s sample=%s delta=%s" % [
		before,
		after,
		SAMPLE,
		color_delta
	])
	root.queue_free()
	await process_frame
	quit(0)
