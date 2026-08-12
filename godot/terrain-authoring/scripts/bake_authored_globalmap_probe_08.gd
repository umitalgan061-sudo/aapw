extends SceneTree

const HTerrain = preload("res://addons/zylann.hterrain/hterrain.gd")
const HTerrainTextureSet = preload("res://addons/zylann.hterrain/hterrain_texture_set.gd")
const GlobalMapBaker = preload("res://addons/zylann.hterrain/tools/globalmap_baker.gd")

const PROBE_DIRECTORY := "res://terrain_polish_probe_007"
const STARTER_GLOBAL_ALBEDO := Color(0.33333334, 0.4509804, 0.2509804, 1.0)
const STARTER_GROUND_TEXTURES := [
	"res://starter_textures/ground_grass.svg",
	"res://starter_textures/ground_earth.svg",
	"res://starter_textures/ground_rock.svg",
	"res://starter_textures/ground_snow.svg",
]

var _finished := false
var _permanent_change := false

func _init() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error(message)
	quit(1)

func _on_progress(info: Dictionary) -> void:
	if bool(info.get("finished", false)):
		_finished = true

func _on_permanent_change(message: String) -> void:
	if message == "Bake globalmap":
		_permanent_change = true

func _run() -> void:
	var data_path := PROBE_DIRECTORY.path_join("data.hterrain")
	if not FileAccess.file_exists(data_path):
		_fail("Iteration 008 requires the authored probe from iteration 007")
		return
	var data = load(data_path)
	if data == null:
		_fail("Authored HTerrain probe data could not be loaded")
		return
	var before := data.get_image(data.CHANNEL_GLOBAL_ALBEDO)
	if before == null:
		_fail("Authored probe global albedo map is missing")
		return
	var before_center := before.get_pixel(before.get_width() / 2, before.get_height() / 2)
	if before_center.distance_to(STARTER_GLOBAL_ALBEDO) > 0.02:
		_fail("Expected uniform starter global albedo before baking")
		return
	var terrain = HTerrain.new()
	terrain.set("collision_enabled", false)
	terrain.set_data(data)
	var texture_set = terrain.get_texture_set()
	for texture_path in STARTER_GROUND_TEXTURES:
		var texture := load(texture_path) as Texture2D
		if texture == null:
			_fail("Starter terrain texture could not be loaded: %s" % texture_path)
			return
		var slot_index: int = texture_set.insert_slot(-1)
		texture_set.set_texture(slot_index, HTerrainTextureSet.TYPE_ALBEDO_BUMP, texture)
	get_root().add_child(terrain)
	await process_frame
	terrain.update_material()
	await process_frame
	var baker = GlobalMapBaker.new()
	baker.progress_notified.connect(_on_progress)
	baker.permanent_change_performed.connect(_on_permanent_change)
	get_root().add_child(baker)
	baker.bake(terrain)
	var frame_budget := 240
	while not _finished and frame_budget > 0:
		frame_budget -= 1
		await process_frame
	if not _finished or not _permanent_change:
		_fail("HTerrain global-map baker did not finish within the bounded frame budget")
		return
	var baked := data.get_image(data.CHANNEL_GLOBAL_ALBEDO)
	if baked == null or baked.get_format() != Image.FORMAT_RGB8:
		_fail("Baked global albedo image is unavailable or has the wrong format")
		return
	var center := baked.get_pixel(baked.get_width() / 2, baked.get_height() / 2)
	var edge := baked.get_pixel(16, 16)
	if center.distance_to(before_center) < 0.03:
		_fail("Authored splat did not produce a meaningful baked global-map delta")
		return
	if edge.distance_to(STARTER_GLOBAL_ALBEDO) > 0.08:
		_fail("Untouched grass edge changed too far during global-map bake")
		return
	data.notify_full_change()
	if not data.save_data(PROBE_DIRECTORY):
		_fail("Baked authored probe could not be persisted")
		return
	print("TERRAIN_POLISH_ITERATION_08_OK center_delta=%.6f edge_delta=%.6f directory=%s" % [center.distance_to(before_center), edge.distance_to(STARTER_GLOBAL_ALBEDO), PROBE_DIRECTORY])
	quit(0)
