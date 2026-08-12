extends SceneTree

const AUTHORING_SCENE := "res://scenes/westeros_terrain_authoring.tscn"
const DEFAULT_OUTPUT := "res://editor_bridge/generated_terrain_data"
const HTerrainData = preload("res://addons/zylann.hterrain/hterrain_data.gd")
const HTerrainGlobalMapBaker = preload("res://addons/zylann.hterrain/tools/globalmap_baker.gd")


func _init() -> void:
	call_deferred("_run")


func _fail(message: String) -> void:
	push_error(message)
	quit(1)


func _arg_value(prefix: String, fallback: String) -> String:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with(prefix):
			return arg.substr(prefix.length())
	return fallback


func _wait_frames(count: int) -> void:
	for _index in range(count):
		await process_frame


func _run() -> void:
	if not Engine.is_editor_hint():
		_fail("HTerrain derived rebake must run with --editor")
		return

	var output := _arg_value("--output=", DEFAULT_OUTPUT)
	if not FileAccess.file_exists(output.path_join("data.hterrain")):
		_fail("HTerrain generated data is missing: %s" % output)
		return

	var packed := load(AUTHORING_SCENE) as PackedScene
	if packed == null:
		_fail("HTerrain authoring scene could not be loaded")
		return
	var root := packed.instantiate()
	get_root().add_child(root)
	await _wait_frames(2)

	var terrain = root.get_node_or_null("HTerrain")
	if terrain == null:
		_fail("HTerrain node is missing")
		return

	var generated = HTerrainData.new()
	generated.load_data(output)
	var resolution: int = generated.get_resolution()
	if resolution <= 0:
		_fail("HTerrain generated data could not be reloaded: %s" % output)
		return
	terrain.set_data(generated)
	await _wait_frames(2)

	var normal_baker = terrain.get("_normals_baker")
	if normal_baker == null or not normal_baker.is_inside_tree():
		_fail("HTerrain normal baker was not created")
		return
	normal_baker.request_tiles_in_region(Rect2i(0, 0, resolution, resolution))
	var normal_frames := 0
	while normal_baker.is_processing() and normal_frames < 256:
		await process_frame
		normal_frames += 1
	if normal_baker.is_processing():
		_fail("HTerrain normal rebake did not finish")
		return

	var global_baker = HTerrainGlobalMapBaker.new()
	root.add_child(global_baker)
	await process_frame
	global_baker.bake(terrain)
	var global_frames := 0
	while global_baker.is_processing() and global_frames < 64:
		await process_frame
		global_frames += 1
	if global_baker.is_processing():
		_fail("HTerrain global albedo rebake did not finish")
		return
	await _wait_frames(2)

	var normal_image := generated.get_image(HTerrainData.CHANNEL_NORMAL)
	var global_image := generated.get_image(HTerrainData.CHANNEL_GLOBAL_ALBEDO)
	if normal_image == null or global_image == null:
		_fail("HTerrain derived maps are unavailable after rebake")
		return
	if not generated.save_data(output):
		_fail("HTerrain rebaked data could not be saved: %s" % output)
		return

	print("HTERRAIN_EDITOR_DERIVED_REBAKE_OK resolution=%s normal_frames=%s global_frames=%s output=%s" % [
		resolution,
		normal_frames,
		global_frames,
		output,
	])
	root.queue_free()
	await process_frame
	quit(0)
