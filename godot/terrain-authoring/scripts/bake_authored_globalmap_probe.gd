extends SceneTree

const HTerrainData = preload("res://addons/zylann.hterrain/hterrain_data.gd")
const GlobalMapBaker = preload("res://addons/zylann.hterrain/tools/globalmap_baker.gd")

const PROBE_DIRECTORY := "res://terrain_polish_probe_007"
const AUTHORING_SCENE := "res://scenes/westeros_terrain_authoring.tscn"
const CENTER := Vector2i(256, 256)
const EDGE := Vector2i(32, 32)
const MAX_BAKE_FRAMES := 600

var _bake_finished := false


func _init() -> void:
	call_deferred("_run")


func _fail(message: String) -> void:
	push_error(message)
	quit(1)


func _on_bake_finished(_message: String) -> void:
	_bake_finished = true


func _run() -> void:
	var packed_scene := load(AUTHORING_SCENE) as PackedScene
	if packed_scene == null:
		_fail("Terrain authoring scene could not be loaded")
		return

	var authoring_scene := packed_scene.instantiate()
	root.add_child(authoring_scene)
	if not authoring_scene.has_method("ensure_authoring_ready") \
	or not authoring_scene.ensure_authoring_ready():
		_fail("Terrain authoring scene could not initialize")
		return

	var terrain = authoring_scene.get_node_or_null("HTerrain")
	if terrain == null:
		_fail("Terrain authoring scene is missing HTerrain")
		return

	terrain.set("collision_enabled", false)
	terrain.set("data_directory", PROBE_DIRECTORY)
	var data = terrain.get_data()
	if data == null:
		_fail("Authored probe terrain data could not be loaded")
		return
	if data.get_resolution() != 513:
		_fail("Authored probe resolution drifted: %s" % data.get_resolution())
		return
	if data.get_map_count(HTerrainData.CHANNEL_GLOBAL_ALBEDO) == 0:
		_fail("Authored probe is missing its starter global albedo map")
		return

	var before := data.get_image(HTerrainData.CHANNEL_GLOBAL_ALBEDO)
	if before == null or before.is_empty():
		_fail("Starter global albedo image is unavailable")
		return
	var before_center := before.get_pixelv(CENTER)
	var before_edge := before.get_pixelv(EDGE)
	if before_center.distance_to(before_edge) > 0.01:
		_fail("Authored probe global albedo was not uniform before baking")
		return

	var baker = GlobalMapBaker.new()
	authoring_scene.add_child(baker)
	baker.permanent_change_performed.connect(_on_bake_finished)
	baker.bake(terrain)

	var waited_frames := 0
	while not _bake_finished and waited_frames < MAX_BAKE_FRAMES:
		await process_frame
		waited_frames += 1
	if not _bake_finished:
		_fail("HTerrain global map baker did not finish within the bounded frame budget")
		return

	var baked := data.get_image(HTerrainData.CHANNEL_GLOBAL_ALBEDO)
	if baked == null or baked.is_empty():
		_fail("Baked global albedo image is unavailable")
		return
	var center := baked.get_pixelv(CENTER)
	var edge := baked.get_pixelv(EDGE)
	if center.distance_to(edge) < 0.04:
		_fail("Baked global albedo did not reflect the authored splat/material variation")
		return
	if center.distance_to(before_center) < 0.04:
		_fail("Baked global albedo did not replace the starter center color")
		return
	if not data.save_data(PROBE_DIRECTORY):
		_fail("Baked authored probe could not be persisted")
		return

	print("TERRAIN_GLOBALMAP_BAKE_OK frames=%s center=(%.6f,%.6f,%.6f) edge=(%.6f,%.6f,%.6f)" % [
		waited_frames,
		center.r,
		center.g,
		center.b,
		edge.r,
		edge.g,
		edge.b,
	])
	authoring_scene.queue_free()
	await process_frame
	quit(0)
