extends SceneTree

const AUTHORING_SCENE := "res://scenes/westeros_terrain_authoring.tscn"
const DATA_DIRECTORY := "res://terrain_data"
const HTerrainData = preload("res://addons/zylann.hterrain/hterrain_data.gd")
const REQUIRED_SNAPSHOT_FILES := [
	"color.png",
	"color.png.import",
	"data.hterrain",
	"data.hterrain.uid",
	"detail.png",
	"detail.png.import",
	"global_albedo.png",
	"global_albedo.png.import",
	"height.res",
	"normal.png",
	"normal.png.import",
	"splat.png",
	"splat.png.import",
]


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

	var data = terrain.get_data()
	if data == null:
		_fail("HTerrain data is missing")
		return
	if data.get_resolution() != 513:
		_fail("Starter HTerrain resolution drifted: %s" % data.get_resolution())
		return
	if data.get_map_count(HTerrainData.CHANNEL_DETAIL) < 1:
		_fail("Snapshot-ready HTerrain data must keep at least one detail map")
		return
	if data.get_map_count(HTerrainData.CHANNEL_GLOBAL_ALBEDO) != 1:
		_fail("Snapshot-ready HTerrain data must keep exactly one starter global albedo map")
		return

	for file_name in REQUIRED_SNAPSHOT_FILES:
		var file_path := DATA_DIRECTORY.path_join(file_name)
		if not FileAccess.file_exists(file_path):
			_fail("Snapshot-ready HTerrain file is missing: %s" % file_name)
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

	print("TERRAIN_POLISH_ITERATION_06_OK resolution=%s snapshot_files=%s global_maps=%s detail_maps=%s" % [
		data.get_resolution(),
		REQUIRED_SNAPSHOT_FILES.size(),
		data.get_map_count(HTerrainData.CHANNEL_GLOBAL_ALBEDO),
		data.get_map_count(HTerrainData.CHANNEL_DETAIL),
	])
	root.queue_free()
	quit(0)
