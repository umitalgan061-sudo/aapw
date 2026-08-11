extends SceneTree

const AUTHORING_SCENE := "res://scenes/westeros_terrain_authoring.tscn"
const HTerrainTextureSet = preload("res://addons/zylann.hterrain/hterrain_texture_set.gd")
const EXPECTED_STARTER_PATHS := [
	"res://starter_textures/ground_grass.svg",
	"res://starter_textures/ground_earth.svg",
	"res://starter_textures/ground_rock.svg",
	"res://starter_textures/ground_snow.svg"
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
	if not root.has_method("ensure_authoring_ready") or not root.call("ensure_authoring_ready"):
		_fail("Terrain authoring bootstrap failed")
		return
	get_root().add_child(root)

	var terrain = root.get_node_or_null("HTerrain")
	if terrain == null:
		_fail("HTerrain node is missing")
		return

	var texture_set = terrain.get_texture_set()
	if texture_set == null or texture_set.get_slots_count() < 4:
		_fail("Four starter terrain slots are required before triplanar evaluation")
		return

	var actual_paths: Array[String] = []
	for slot_index in range(4):
		var texture = texture_set.get_texture(slot_index, HTerrainTextureSet.TYPE_ALBEDO_BUMP)
		if texture == null:
			_fail("Terrain texture slot %s is empty" % slot_index)
			return
		actual_paths.append(texture.resource_path)

	for slot_index in range(4):
		if actual_paths[slot_index] != EXPECTED_STARTER_PATHS[slot_index]:
			_fail("Starter slot order drifted at %s: %s" % [slot_index, actual_paths])
			return

	if bool(terrain.get_shader_param("u_triplanar")):
		_fail("Triplanar must remain disabled while slot 3 is snow rather than the cliff/rock layer")
		return

	if actual_paths[2] != "res://starter_textures/ground_rock.svg":
		_fail("Rock/cliff candidate is not slot 2")
		return
	if actual_paths[3] != "res://starter_textures/ground_snow.svg":
		_fail("Classic4Lite triplanar target slot 3 is not snow as expected")
		return

	var shader_source := FileAccess.get_file_as_string("res://addons/zylann.hterrain/shaders/simple4_lite.gdshader")
	if shader_source.find("ab3 = texture_triplanar(u_ground_albedo_bump_3") == -1:
		_fail("Classic4Lite triplanar target contract changed")
		return

	print("TERRAIN_POLISH_ITERATION_02_OK rock_slot=2 triplanar_slot=3 triplanar_enabled=false slots=%s" % [actual_paths])
	root.queue_free()
	quit(0)
