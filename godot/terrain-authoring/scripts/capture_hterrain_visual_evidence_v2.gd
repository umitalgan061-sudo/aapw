extends SceneTree

const AUTHORING_SCENE := "res://scenes/westeros_terrain_authoring.tscn"
const HTerrainData = preload("res://addons/zylann.hterrain/hterrain_data.gd")
const OUTPUT_DIRECTORY := "res://artifacts/run264-hterrain-v2"
const IMAGE_SIZE := Vector2i(1280, 720)
const TERRAIN_CENTER := Vector3(256.0, 28.0, 256.0)


func _init() -> void:
	call_deferred("_capture_evidence")


func _fail(message: String) -> void:
	push_error(message)
	quit(1)


func _capture_evidence() -> void:
	get_root().size = IMAGE_SIZE

	var packed := load(AUTHORING_SCENE) as PackedScene
	if packed == null:
		_fail("HTerrain evidence scene could not be loaded")
		return

	var scene := packed.instantiate()
	if not scene.has_method("ensure_authoring_ready"):
		_fail("HTerrain evidence bootstrap contract is missing")
		return

	# Prepare Terrain Data before any HTerrainDetailLayer enters the scene tree.
	if not scene.call("ensure_authoring_ready"):
		_fail("HTerrain evidence bootstrap failed before tree entry")
		return

	var terrain = scene.get_node_or_null("HTerrain")
	var camera := scene.get_node_or_null("Camera3D") as Camera3D
	if terrain == null or camera == null:
		_fail("HTerrain evidence terrain/camera is missing")
		return

	var data = terrain.get_data()
	if data == null:
		_fail("HTerrain evidence Terrain Data is missing")
		return

	# This evidence is intentionally ephemeral. Rebuild default in-memory maps so the
	# proof never depends on files produced by a previous CI step or on imported PNG state.
	data._edit_load_default()
	if data.get_map_count(HTerrainData.CHANNEL_DETAIL) == 0:
		data._edit_add_map(HTerrainData.CHANNEL_DETAIL)

	var height_image: Image = data.get_image(HTerrainData.CHANNEL_HEIGHT)
	var splat_image: Image = data.get_image(HTerrainData.CHANNEL_SPLAT)
	var detail_image: Image = data.get_image(HTerrainData.CHANNEL_DETAIL, 0)
	if height_image == null or splat_image == null or detail_image == null:
		_fail("HTerrain evidence default in-memory maps are incomplete")
		return

	get_root().add_child(scene)
	await process_frame
	await process_frame

	var resolution: int = data.get_resolution()
	var center := Vector2(float(resolution - 1) * 0.5, float(resolution - 1) * 0.5)
	for y in range(resolution):
		for x in range(resolution):
			var offset := Vector2(float(x), float(y)) - center
			var distance := offset.length()
			var main_hill := maxf(0.0, 1.0 - distance / 230.0)
			var ridge := maxf(0.0, 1.0 - absf(float(x - y)) / 145.0)
			var height := main_hill * main_hill * 92.0 + ridge * 14.0
			height_image.set_pixel(x, y, Color(height, 0.0, 0.0, 1.0))

			if x < resolution / 2 and y < resolution / 2:
				splat_image.set_pixel(x, y, Color(1.0, 0.0, 0.0, 0.0))
			elif x >= resolution / 2 and y < resolution / 2:
				splat_image.set_pixel(x, y, Color(0.0, 1.0, 0.0, 0.0))
			elif x < resolution / 2:
				splat_image.set_pixel(x, y, Color(0.0, 0.0, 1.0, 0.0))
			else:
				splat_image.set_pixel(x, y, Color(0.0, 0.0, 0.0, 1.0))

			var grass_distance := Vector2(float(x) - 190.0, float(y) - 220.0).length()
			var grass_density := 0.82 if grass_distance < 72.0 else 0.0
			detail_image.set_pixel(x, y, Color(grass_density, grass_density, grass_density, 1.0))

	var full_region := Rect2(0.0, 0.0, float(resolution), float(resolution))
	data.notify_region_change(full_region, HTerrainData.CHANNEL_HEIGHT)
	data.notify_region_change(full_region, HTerrainData.CHANNEL_SPLAT)
	data.notify_region_change(full_region, HTerrainData.CHANNEL_DETAIL)
	terrain.update_collider()

	var output_absolute := ProjectSettings.globalize_path(OUTPUT_DIRECTORY)
	var directory_error := DirAccess.make_dir_recursive_absolute(output_absolute)
	if directory_error != OK:
		_fail("HTerrain evidence output directory could not be created: %s" % directory_error)
		return

	await _capture_angle(
		camera,
		Vector3(256.0, 250.0, 690.0),
		TERRAIN_CENTER,
		OUTPUT_DIRECTORY.path_join("angle-far.png"))
	await _capture_angle(
		camera,
		Vector3(105.0, 138.0, 405.0),
		Vector3(210.0, 38.0, 238.0),
		OUTPUT_DIRECTORY.path_join("angle-near.png"))

	print("HTERRAIN_VISUAL_EVIDENCE_V2_OK far=angle-far.png near=angle-near.png resolution=%s" % resolution)
	scene.queue_free()
	await process_frame
	quit(0)


func _capture_angle(camera: Camera3D, position: Vector3, target: Vector3, output_path: String) -> void:
	camera.global_position = position
	camera.look_at(target, Vector3.UP)
	for _frame in range(30):
		await process_frame
	var image := get_root().get_texture().get_image()
	if image == null or image.is_empty():
		_fail("HTerrain visual evidence viewport image is empty")
		return
	var save_error := image.save_png(ProjectSettings.globalize_path(output_path))
	if save_error != OK:
		_fail("HTerrain visual evidence PNG could not be saved: %s" % save_error)
