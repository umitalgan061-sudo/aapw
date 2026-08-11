extends SceneTree

const AUTHORING_SCENE := "res://scenes/westeros_terrain_authoring.tscn"
const DATA_DIRECTORY := "res://terrain_data"
const HTerrainData = preload("res://addons/zylann.hterrain/hterrain_data.gd")
const HTerrainTextureSet = preload("res://addons/zylann.hterrain/hterrain_texture_set.gd")


func _init() -> void:
	call_deferred("_run_validation")


func _fail(message: String) -> void:
	push_error(message)
	quit(1)


func _run_validation() -> void:
	var packed := load(AUTHORING_SCENE) as PackedScene
	if packed == null:
		_fail("HTerrain authoring scene could not be loaded")
		return

	var root := packed.instantiate()
	get_root().add_child(root)

	if not root.has_method("ensure_authoring_ready"):
		_fail("HTerrain authoring bootstrap contract is missing")
		return

	if not root.call("ensure_authoring_ready"):
		_fail("HTerrain authoring bootstrap failed")
		return

	var terrain = root.get_node_or_null("HTerrain")
	if terrain == null:
		_fail("HTerrain node is missing")
		return

	var data = terrain.get_data()
	if data == null:
		_fail("HTerrain data is missing")
		return

	if data.get_resolution() != HTerrainData.DEFAULT_RESOLUTION:
		_fail("Unexpected HTerrain default resolution: %s" % data.get_resolution())
		return

	if data.get_map_count(HTerrainData.CHANNEL_DETAIL) < 1:
		_fail("Grass/detail paint map was not created")
		return

	var texture_set = terrain.get_texture_set()
	if texture_set.get_mode() != HTerrainTextureSet.MODE_TEXTURES:
		_fail("Starter texture set is not in texture mode")
		return

	if texture_set.get_slots_count() < 4:
		_fail("Four starter terrain texture layers were not created")
		return

	for slot_index in range(4):
		if texture_set.get_texture(slot_index, HTerrainTextureSet.TYPE_ALBEDO_BUMP) == null:
			_fail("Starter terrain texture slot %s is empty" % slot_index)
			return

	var detail_layer = terrain.get_node_or_null("GrassDetailLayer")
	if detail_layer == null:
		_fail("HTerrainDetailLayer is missing")
		return

	if not detail_layer.fixed_seed_enabled:
		_fail("Grass detail layer must use deterministic seeding")
		return

	if detail_layer.texture == null:
		_fail("Grass detail layer starter texture is missing")
		return

	if not FileAccess.file_exists(DATA_DIRECTORY.path_join(HTerrainData.META_FILENAME)):
		_fail("HTerrain data metadata was not persisted")
		return

	print("HTERRAIN_AUTHORING_VALIDATION_OK resolution=%s texture_slots=%s detail_maps=%s seed=%s" % [
		data.get_resolution(),
		texture_set.get_slots_count(),
		data.get_map_count(HTerrainData.CHANNEL_DETAIL),
		detail_layer.fixed_seed
	])
	root.queue_free()
	quit(0)
