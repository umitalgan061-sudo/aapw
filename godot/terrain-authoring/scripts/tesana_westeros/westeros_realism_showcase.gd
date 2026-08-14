extends Node3D

const ASSET_ROOT := "res://assets/tesana_westeros"
const TreeForestScript = preload("res://assets/tesana_westeros/trees/tree_spawner.gd")
const LEAF_SHADER = preload("res://shaders/tesana_westeros/realistic_leaf_atlas.gdshader")
const LEAF_ATLAS = preload("res://assets/tesana_westeros/trees/foliage/pine_needles.png")
const BARK_TEXTURE = preload("res://assets/tesana_westeros/trees/bark/pine_bark.png")
const WATER_BASE = preload("res://materials/tesana_westeros/realistic_water_base.tres")
const SKY_PANORAMA = preload("res://assets/tesana_westeros/textures/skyboxes/photoreal_northern_storm_panorama.png")
const OPEN_LAND_AMBIENCE = preload("res://assets/tesana_westeros/audio/ambient/ambient_open_grassland_plains_wind_crows.mp3")
const EXPLORATION_MUSIC = preload("res://assets/tesana_westeros/audio/music/music_exploration_westeros_thrones_theme.mp3")

@export_range(24, 240, 1) var forest_tree_count: int = 96
@export var spawn_full_asset_catalog: bool = true
@export var play_ambient_audio: bool = true

const CHARACTER_SPECS := [
	{"name": "PlayerHeir", "model": "characters/player_heir/player_heir.glb", "animations": "characters/player_heir/player_heir_animations.tres", "clip": "ual1_Idle_LookAround", "position": Vector3(0, 0, 7)},
	{"name": "QueenSouth", "model": "characters/queen_south/queen_south.glb", "animations": "characters/queen_south/queen_south_animations.tres", "clip": "ual1_Idle_Talking", "position": Vector3(-4, 0, 8)},
	{"name": "SwornKnight", "model": "characters/sworn_knight/sworn_knight.glb", "animations": "characters/sworn_knight/sworn_knight_animations.tres", "clip": "ual2_Sword_Block", "position": Vector3(4, 0, 8)},
	{"name": "KingNorth", "model": "characters/king_north/king_north.glb", "animations": "characters/king_north/king_north_animations.tres", "clip": "ual1_Sword_Enter", "position": Vector3(-8, 0, 10)},
	{"name": "PeasantMan", "model": "characters/peasant_man/peasant_man.glb", "animations": "characters/peasant_man/peasant_man_animations.tres", "clip": "ual1_Idle", "position": Vector3(8, 0, 10)},
	{"name": "VillageWoman", "model": "characters/village_woman/village_woman.glb", "animations": "characters/village_woman/village_woman_animations.tres", "clip": "ual1_Idle_LookAround", "position": Vector3(-12, 0, 12)},
	{"name": "BanditRaider", "model": "characters/bandit_raider/bandit_raider.glb", "animations": "characters/bandit_raider/bandit_raider_animations.tres", "clip": "ual1_Sword_Idle", "position": Vector3(12, 0, 12)},
]

const WORLD_SPECS := [
	{"name": "NorthKeep", "model": "environment/buildings/north_keep.glb", "position": Vector3(0, 0, -20), "rotation_y": 3.14159},
	{"name": "VillageHouseA", "model": "environment/buildings/village_house_a.glb", "position": Vector3(-22, 0, 2), "rotation_y": 0.7},
	{"name": "VillageHouseB", "model": "environment/buildings/village_house_b.glb", "position": Vector3(22, 0, 2), "rotation_y": -0.65},
	{"name": "DragonSpire", "model": "environment/rocks/dragon_spire.glb", "position": Vector3(42, 0, -24), "rotation_y": 0.2},
	{"name": "Watchtower", "model": "environment/structures/westeros_watchtower.glb", "position": Vector3(-42, 0, -24), "rotation_y": -0.25},
	{"name": "HouseBanner", "model": "props/decorations/house_banner.glb", "position": Vector3(-2, 0, 3), "rotation_y": 0.0},
	{"name": "IronThrone", "model": "props/furniture/iron_throne.glb", "position": Vector3(2, 0, 3), "rotation_y": 3.14159},
	{"name": "BanditTent", "model": "props/misc/bandit_tent.glb", "position": Vector3(28, 0, 24), "rotation_y": -0.8},
	{"name": "BlackDragon", "model": "props/misc/black_dragon.glb", "position": Vector3(34, 5, -10), "rotation_y": -1.4},
	{"name": "Campfire", "model": "props/misc/campfire.glb", "position": Vector3(25, 0, 20), "rotation_y": 0.0},
	{"name": "CastleCat", "model": "props/misc/castle_cat.glb", "position": Vector3(-2, 0, 11), "rotation_y": 0.4},
	{"name": "FarmCow", "model": "props/misc/farm_cow.glb", "position": Vector3(-26, 0, 20), "rotation_y": 0.6},
	{"name": "FarmSheep", "model": "props/misc/farm_sheep.glb", "position": Vector3(-21, 0, 22), "rotation_y": -0.3},
	{"name": "LoyalHound", "model": "props/misc/loyal_hound.glb", "position": Vector3(2, 0, 11), "rotation_y": -0.4},
	{"name": "BanditAxe", "model": "props/weapons/bandit_axe.glb", "position": Vector3(6, 0.7, 5), "rotation_y": 0.25, "scale": 1.4},
	{"name": "ValyrianLongsword", "model": "props/weapons/longsword_valyrian.glb", "position": Vector3(-6, 0.7, 5), "rotation_y": -0.25, "scale": 1.4},
]

func _ready() -> void:
	_configure_environment()
	_build_ground()
	_build_water_bodies()
	_build_forest()
	_spawn_characters()
	if spawn_full_asset_catalog:
		_spawn_world_assets()
	if play_ambient_audio:
		_start_audio()
	var camera := get_node_or_null("Camera3D") as Camera3D
	if camera != null:
		camera.look_at(Vector3(0.0, 4.5, 0.0), Vector3.UP)

func _configure_environment() -> void:
	var world_environment := get_node_or_null("WorldEnvironment") as WorldEnvironment
	if world_environment == null:
		return
	var panorama_material := PanoramaSkyMaterial.new()
	panorama_material.panorama = SKY_PANORAMA
	panorama_material.energy_multiplier = 0.72
	var sky := Sky.new()
	sky.sky_material = panorama_material
	sky.process_mode = Sky.PROCESS_MODE_REALTIME
	# The panorama is static, so high-quality importance sampling gives cleaner reflections.
	sky.process_mode = Sky.PROCESS_MODE_QUALITY
	sky.radiance_size = Sky.RADIANCE_SIZE_512
	var environment := Environment.new()
	environment.background_mode = Environment.BG_SKY
	environment.sky = sky
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	environment.ambient_light_energy = 0.48
	environment.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	# AgX preserves highlight hues more naturally under the cold high-contrast sky.
	environment.tonemap_mode = Environment.TONE_MAPPER_AGX
	environment.tonemap_exposure = 0.92
	environment.fog_enabled = true
	environment.fog_light_color = Color(0.32, 0.37, 0.41)
	environment.fog_light_energy = 0.42
	environment.fog_density = 0.0065
	environment.fog_height = 2.0
	environment.fog_height_density = 0.04
	environment.fog_sun_scatter = 0.12
	environment.fog_aerial_perspective = 0.14
	world_environment.environment = environment

func _build_ground() -> void:
	var ground_mesh := PlaneMesh.new()
	ground_mesh.size = Vector2(220.0, 220.0)
	ground_mesh.subdivide_width = 12
	ground_mesh.subdivide_depth = 12
	var ground_material := StandardMaterial3D.new()
	ground_material.albedo_texture = load(ASSET_ROOT + "/terrain/grass/grass_albedo.png") as Texture2D
	ground_material.roughness = 0.96
	ground_material.metallic = 0.0
	ground_material.uv1_scale = Vector3(0.075, 0.075, 0.075)
	ground_material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	ground_mesh.material = ground_material
	var ground := MeshInstance3D.new()
	ground.name = "PBRGround"
	ground.mesh = ground_mesh
	ground.position.y = -0.12
	add_child(ground)

	var road_mesh := PlaneMesh.new()
	road_mesh.size = Vector2(8.0, 86.0)
	var road_material := StandardMaterial3D.new()
	road_material.albedo_texture = load(ASSET_ROOT + "/textures/nature/dirt_path.png") as Texture2D
	road_material.roughness = 1.0
	road_material.uv1_scale = Vector3(0.18, 0.18, 0.18)
	road_mesh.material = road_material
	var road := MeshInstance3D.new()
	road.name = "DirtRoad"
	road.mesh = road_mesh
	road.position = Vector3(0.0, -0.09, 15.0)
	add_child(road)

func _build_water_bodies() -> void:
	_create_water("Ocean", Vector3(0.0, -0.2, -84.0), Vector2(210.0, 76.0), Color(0.055, 0.14, 0.19), Color(0.006, 0.025, 0.055), Vector2(0.025, 0.012), 0.28)
	_create_water("Lake", Vector3(-46.0, 0.04, 31.0), Vector2(40.0, 28.0), Color(0.07, 0.20, 0.22), Color(0.01, 0.055, 0.075), Vector2(0.009, 0.006), 0.10)
	_create_water("River", Vector3(47.0, 0.02, 18.0), Vector2(12.0, 82.0), Color(0.08, 0.22, 0.24), Color(0.012, 0.06, 0.08), Vector2(0.034, 0.006), 0.12)
	_create_water("Pond", Vector3(-14.0, 0.03, 34.0), Vector2(15.0, 11.0), Color(0.085, 0.18, 0.16), Color(0.012, 0.045, 0.04), Vector2(0.004, 0.003), 0.045)

func _create_water(body_name: String, body_position: Vector3, body_size: Vector2, surface_color: Color, depth_color: Color, velocity: Vector2, displacement: float) -> void:
	var material := WATER_BASE.duplicate() as ShaderMaterial
	material.set_shader_parameter("surface_color", surface_color)
	material.set_shader_parameter("depth_color", depth_color)
	material.set_shader_parameter("wave_velocity", velocity)
	material.set_shader_parameter("displacement_amount", displacement)
	var plane := PlaneMesh.new()
	plane.size = body_size
	plane.subdivide_width = 64
	plane.subdivide_depth = 64
	plane.material = material
	var water := MeshInstance3D.new()
	water.name = body_name
	water.mesh = plane
	water.position = body_position
	add_child(water)

func _build_forest() -> void:
	var leaf_material := ShaderMaterial.new()
	leaf_material.shader = LEAF_SHADER
	leaf_material.set_shader_parameter("leaf_atlas", LEAF_ATLAS)
	leaf_material.set_shader_parameter("tint_color", Color(0.48, 0.62, 0.42))
	leaf_material.set_shader_parameter("tint_strength", 0.28)
	var bark_material: Material = TreeForestScript.make_bark_material(Color(0.19, 0.13, 0.085), BARK_TEXTURE)
	var forest = TreeForestScript.new()
	forest.name = "NorthernPineForest"
	add_child(forest)
	var pine_params := {
		"seed": 90421,
		"trunk_height": 11.5,
		"trunk_radius": 0.46,
		"taper": 0.32,
		"levels": 3,
		"branches_per_level": 7,
		"branch_angle_deg": 74.0,
		"length_ratio": 0.65,
		"radius_ratio": 0.52,
		"gnarl": 0.11,
		"upward_bias": 0.14,
		"segments_per_branch": 5,
		"radial_segments": 7,
		"branch_start": 0.18,
		"branch_mode": 1,
		"length_falloff": 0.46,
		"droop": 0.10,
		"cluster_along": 0.42,
		"leaf_card_size": 1.05,
		"leaf_size_jitter": 0.24,
		"leaves_per_cluster": 5,
		"cluster_radius": 0.72,
	}
	forest.setup(pine_params, 2, leaf_material, bark_material, forest_tree_count, 72.0, {
		"scale_jitter": 0.34,
		"lod_distance": 62.0,
		"lod_blend_band": 28.0,
		"seed": 90421,
		"variant_jitter": {"trunk_height": 0.22, "branch_angle_deg": 0.10, "droop": 0.24},
	})
	forest.build()

func _spawn_characters() -> void:
	var group := Node3D.new()
	group.name = "AnimatedCharacters"
	add_child(group)
	for spec in CHARACTER_SPECS:
		var actor := _instantiate_asset(spec, group)
		if actor != null:
			_attach_animation_library(actor, ASSET_ROOT + "/" + str(spec["animations"]), str(spec["clip"]))

func _spawn_world_assets() -> void:
	var group := Node3D.new()
	group.name = "BuildingsAnimalsAndProps"
	add_child(group)
	for spec in WORLD_SPECS:
		_instantiate_asset(spec, group)

func _instantiate_asset(spec: Dictionary, parent: Node3D) -> Node3D:
	var resource := load(ASSET_ROOT + "/" + str(spec["model"]))
	if not resource is PackedScene:
		push_warning("Tesana asset could not be loaded: %s" % spec["model"])
		return null
	var instance := (resource as PackedScene).instantiate() as Node3D
	if instance == null:
		return null
	instance.name = str(spec["name"])
	instance.position = spec.get("position", Vector3.ZERO)
	instance.rotation.y = float(spec.get("rotation_y", 0.0))
	var uniform_scale := float(spec.get("scale", 1.0))
	instance.scale = Vector3.ONE * uniform_scale
	parent.add_child(instance)
	return instance

func _attach_animation_library(actor: Node3D, library_path: String, preferred_clip: String) -> void:
	# Tesana animation tracks use %GeneralSkeleton. GLB import preserves the
	# bones but may flatten the node name to Skeleton3D, so restore the unique
	# runtime target before the AnimationPlayer builds its track cache.
	var skeletons := actor.find_children("*", "Skeleton3D", true, false)
	if not skeletons.is_empty():
		var general_skeleton := skeletons[0] as Skeleton3D
		general_skeleton.name = "GeneralSkeleton"
		general_skeleton.unique_name_in_owner = true
	var library := load(library_path) as AnimationLibrary
	if library == null:
		push_warning("Animation library could not be loaded: %s" % library_path)
		return
	var player := actor.find_child("AnimationPlayer", true, false) as AnimationPlayer
	if player == null:
		player = AnimationPlayer.new()
		player.name = "TesanaAnimationPlayer"
		actor.add_child(player)
		player.root_node = NodePath("..")
	if player.has_animation_library(&"tesana"):
		player.remove_animation_library(&"tesana")
	player.add_animation_library(&"tesana", library)
	var full_clip := StringName("tesana/%s" % preferred_clip)
	if player.has_animation(full_clip):
		player.play(full_clip)

func _start_audio() -> void:
	var ambience := AudioStreamPlayer.new()
	ambience.name = "OpenLandAmbience"
	ambience.stream = OPEN_LAND_AMBIENCE
	if ambience.stream is AudioStreamMP3:
		(ambience.stream as AudioStreamMP3).loop = true
	ambience.volume_db = -17.0
	add_child(ambience)
	ambience.play()
	var music := AudioStreamPlayer.new()
	music.name = "ExplorationMusic"
	music.stream = EXPLORATION_MUSIC
	if music.stream is AudioStreamMP3:
		(music.stream as AudioStreamMP3).loop = true
	music.volume_db = -23.0
	add_child(music)
	music.play()
