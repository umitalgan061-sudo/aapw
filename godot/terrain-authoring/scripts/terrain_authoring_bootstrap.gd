@tool
extends Node3D

const HTerrainData = preload("res://addons/zylann.hterrain/hterrain_data.gd")
const HTerrainTextureSet = preload("res://addons/zylann.hterrain/hterrain_texture_set.gd")

const DATA_DIRECTORY := "res://terrain_data"
const STARTER_GROUND_TEXTURES := [
	"res://starter_textures/ground_grass.svg",
	"res://starter_textures/ground_earth.svg",
	"res://starter_textures/ground_rock.svg",
	"res://starter_textures/ground_snow.svg"
]
const STARTER_GRASS_TEXTURE := "res://starter_textures/detail_grass.svg"

var _authoring_ready := false


func _enter_tree() -> void:
	if Engine.is_editor_hint():
		ensure_authoring_ready()


func ensure_authoring_ready() -> bool:
	if _authoring_ready:
		return true

	var terrain = get_node_or_null("HTerrain")
	if terrain == null:
		push_error("HTerrain authoring scene is missing the HTerrain node")
		return false

	var initial_data_creation := terrain.get_data() == null
	if initial_data_creation:
		terrain.set("collision_enabled", false)
		terrain.set("data_directory", DATA_DIRECTORY)

	var data = terrain.get_data()
	if data == null:
		push_error("HTerrain data could not be created at %s" % DATA_DIRECTORY)
		return false

	var data_changed := false
	if data.get_resolution() == 0:
		data._edit_load_default()
		data_changed = true

	if data.get_map_count(HTerrainData.CHANNEL_DETAIL) == 0:
		data._edit_add_map(HTerrainData.CHANNEL_DETAIL)
		data_changed = true

	var texture_set = terrain.get_texture_set()
	if texture_set.get_mode() == HTerrainTextureSet.MODE_TEXTURES \
	and texture_set.get_slots_count() == 0:
		for texture_path in STARTER_GROUND_TEXTURES:
			var texture := load(texture_path) as Texture2D
			if texture == null:
				push_error("Starter terrain texture could not be loaded: %s" % texture_path)
				return false
			var slot_index: int = texture_set.insert_slot(-1)
			texture_set.set_texture(
				slot_index,
				HTerrainTextureSet.TYPE_ALBEDO_BUMP,
				texture)

	var detail_layer = terrain.get_node_or_null("GrassDetailLayer")
	if detail_layer != null and detail_layer.texture == null:
		var grass_texture := load(STARTER_GRASS_TEXTURE) as Texture2D
		if grass_texture == null:
			push_error("Starter grass texture could not be loaded: %s" % STARTER_GRASS_TEXTURE)
			return false
		detail_layer.texture = grass_texture

	if data_changed:
		data.notify_full_change()
		if not data.save_data(DATA_DIRECTORY):
			push_error("HTerrain data could not be saved at %s" % DATA_DIRECTORY)
			return false

	if initial_data_creation:
		terrain.set("collision_enabled", true)
		terrain.update_collider()
	elif bool(terrain.get("collision_enabled")) and data_changed:
		terrain.update_collider()

	if detail_layer != null and detail_layer.is_inside_tree():
		detail_layer.update_material()

	_authoring_ready = true
	return true

# Run269 terrain polish: fill only missing starter normal+roughness channels.
# Existing owner-authored PBR textures are never replaced.
const STARTER_NORMAL_ROUGHNESS_TEXTURES := [
	"res://starter_textures/ground_grass_normal_roughness.png",
	"res://starter_textures/ground_earth_normal_roughness.png",
	"res://starter_textures/ground_rock_normal_roughness.png",
	"res://starter_textures/ground_snow_normal_roughness.png"
]

var _starter_pbr_polish_checked := false


func _process(_delta: float) -> void:
	if not Engine.is_editor_hint() or _starter_pbr_polish_checked or not _authoring_ready:
		return
	_starter_pbr_polish_checked = ensure_starter_pbr_ready()


func ensure_starter_pbr_ready() -> bool:
	var terrain = get_node_or_null("HTerrain")
	if terrain == null:
		push_error("Starter PBR polish could not find HTerrain")
		return false

	var texture_set = terrain.get_texture_set()
	if texture_set.get_mode() != HTerrainTextureSet.MODE_TEXTURES:
		return true

	var slot_count: int = min(texture_set.get_slots_count(), STARTER_NORMAL_ROUGHNESS_TEXTURES.size())
	for slot_index in range(slot_count):
		if texture_set.get_texture(slot_index, HTerrainTextureSet.TYPE_NORMAL_ROUGHNESS) != null:
			continue
		var texture_path: String = STARTER_NORMAL_ROUGHNESS_TEXTURES[slot_index]
		var texture := load(texture_path) as Texture2D
		if texture == null:
			push_error("Starter normal/roughness texture could not be loaded: %s" % texture_path)
			return false
		texture_set.set_texture(
			slot_index,
			HTerrainTextureSet.TYPE_NORMAL_ROUGHNESS,
			texture)

	return true
