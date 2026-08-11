extends SceneTree

const AUTHORING_SCENE := "res://scenes/westeros_terrain_authoring.tscn"
const EXPECTED_ALBEDO_BUMP_FILES := [
	"ground_grass.svg",
	"ground_earth.svg",
	"ground_rock.svg",
	"ground_snow.svg"
]


func _init() -> void:
	call_deferred("_run_validation")


func _fail(message: String) -> void:
	push_error(message)
	quit(1)


func _run_validation() -> void:
	var packed := load(AUTHORING_SCENE) as PackedScene
	if packed == null:
		_fail("Terrain authoring scene could not be loaded")
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

	var texture_set = terrain.get_texture_set()
	if texture_set == null:
		_fail("HTerrain texture set is missing")
		return

	if texture_set.get_slots_count() != EXPECTED_ALBEDO_BUMP_FILES.size():
		_fail("Terrain texture slot count changed: %s" % [texture_set.get_slots_count()])
		return

	for slot_index in range(EXPECTED_ALBEDO_BUMP_FILES.size()):
		var texture = texture_set.get_texture(slot_index, 0)
		if texture == null:
			_fail("Terrain texture slot %d is empty" % slot_index)
			return
		var texture_path := String(texture.resource_path)
		if not texture_path.ends_with(EXPECTED_ALBEDO_BUMP_FILES[slot_index]):
			_fail("Terrain texture slot %d expected %s but resolved %s" % [slot_index, EXPECTED_ALBEDO_BUMP_FILES[slot_index], texture_path])
			return

	var triplanar = terrain.get_shader_param("u_triplanar")
	if triplanar != null and bool(triplanar):
		_fail("Classic4Lite triplanar must remain disabled while slot 3 is snow; enabling it would affect snow rather than rock")
		return

	print("TERRAIN_TEXTURE_SLOT_CONTRACT_OK slots=grass,earth,rock,snow triplanar=false")
	root.queue_free()
	quit(0)
