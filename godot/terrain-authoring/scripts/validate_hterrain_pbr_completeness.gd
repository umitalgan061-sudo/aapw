extends SceneTree

const AUTHORING_SCENE := "res://scenes/westeros_terrain_authoring.tscn"
const HTerrainTextureSet = preload("res://addons/zylann.hterrain/hterrain_texture_set.gd")

const EXPECTED_TEXTURES := [
	"res://starter_textures/ground_grass_normal_roughness.png",
	"res://starter_textures/ground_earth_normal_roughness.png",
	"res://starter_textures/ground_rock_normal_roughness.png",
	"res://starter_textures/ground_snow_normal_roughness.png"
]


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

	if not root.call("ensure_authoring_ready"):
		_fail("HTerrain authoring bootstrap failed")
		return
	if not root.has_method("ensure_starter_pbr_ready"):
		_fail("Starter PBR completeness contract is missing")
		return
	if not root.call("ensure_starter_pbr_ready"):
		_fail("Starter PBR completeness bootstrap failed")
		return

	var terrain = root.get_node_or_null("HTerrain")
	if terrain == null:
		_fail("HTerrain node is missing")
		return

	var texture_set = terrain.get_texture_set()
	if texture_set.get_mode() != HTerrainTextureSet.MODE_TEXTURES:
		_fail("Starter texture set must stay in texture mode")
		return

	for slot_index in range(4):
		var pbr_texture = texture_set.get_texture(
			slot_index,
			HTerrainTextureSet.TYPE_NORMAL_ROUGHNESS)
		if pbr_texture == null:
			_fail("Normal/roughness texture is missing in slot %s" % slot_index)
			return
		if pbr_texture.resource_path != EXPECTED_TEXTURES[slot_index]:
			_fail("Unexpected normal/roughness texture in slot %s: %s" % [
				slot_index,
				pbr_texture.resource_path
			])
			return

	print("HTERRAIN_PBR_COMPLETENESS_OK slots=4 overwrite_policy=missing_only")
	root.queue_free()
	quit(0)
