extends SceneTree

const SCENE_PATH := "res://scenes/westeros_terrain_authoring.tscn"
const HTerrainData = preload("res://addons/zylann.hterrain/hterrain_data.gd")
const HTGlobalMapBaker = preload("res://addons/zylann.hterrain/tools/globalmap_baker.gd")

const TINT_BOTTOM := 0.55
const TINT_TOP := 0.10
const CAPTURE_SIZE := Vector2i(960, 540)
const CLOSE_POSITION := Vector3(244.0, 7.0, 276.0)
const CLOSE_TARGET := Vector3(256.0, 0.4, 258.0)
const FAR_POSITION := Vector3(256.0, 42.0, 326.0)
const FAR_TARGET := Vector3(256.0, 0.0, 258.0)

var _scene_root: Node3D
var _terrain: Node3D
var _detail_layer: Node3D
var _camera: Camera3D


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	var packed := load(SCENE_PATH) as PackedScene
	if packed == null:
		_fail("Could not load terrain authoring scene")
		return

	_scene_root = packed.instantiate() as Node3D
	if _scene_root == null:
		_fail("Could not instantiate terrain authoring scene")
		return
	root.add_child(_scene_root)
	await process_frame

	if not _scene_root.has_method("ensure_authoring_ready"):
		_fail("Terrain authoring bootstrap API is missing")
		return
	_scene_root.call("ensure_authoring_ready")
	await process_frame

	_terrain = _scene_root.get_node_or_null("HTerrain") as Node3D
	_detail_layer = _scene_root.get_node_or_null("HTerrain/GrassDetailLayer") as Node3D
	_camera = _scene_root.get_node_or_null("Camera3D") as Camera3D
	if _terrain == null or _detail_layer == null or _camera == null:
		_fail("Required HTerrain, GrassDetailLayer or Camera3D node is missing")
		return

	var data = _terrain.call("get_data")
	if data == null:
		_fail("HTerrain data is null after bootstrap")
		return
	if int(data.call("get_map_count", HTerrainData.CHANNEL_DETAIL)) < 1:
		_fail("No detail map exists for visual proof")
		return

	_prepare_proof_maps(data)
	await _bake_global_map()
	_detail_layer.call("update_material")

	root.size = CAPTURE_SIZE
	_camera.current = true
	_camera.fov = 58.0

	var output_dir := OS.get_environment("TERRAIN_PROOF_DIR")
	if output_dir.is_empty():
		output_dir = ProjectSettings.globalize_path("user://terrain-polish-004-proof")
	var mkdir_error := DirAccess.make_dir_recursive_absolute(output_dir)
	if mkdir_error != OK:
		_fail("Could not create proof directory: %s" % output_dir)
		return

	_set_tint(0.0, 0.0)
	var close_before := await _capture(CLOSE_POSITION, CLOSE_TARGET, output_dir.path_join("close-before.png"))
	var far_before := await _capture(FAR_POSITION, FAR_TARGET, output_dir.path_join("far-before.png"))
	if close_before == null or far_before == null:
		return

	_set_tint(TINT_BOTTOM, TINT_TOP)
	var close_after := await _capture(CLOSE_POSITION, CLOSE_TARGET, output_dir.path_join("close-after.png"))
	var far_after := await _capture(FAR_POSITION, FAR_TARGET, output_dir.path_join("far-after.png"))
	if close_after == null or far_after == null:
		return

	var close_metrics := _difference_metrics(close_before, close_after)
	var far_metrics := _difference_metrics(far_before, far_after)
	print("TERRAIN_POLISH_ITERATION_04_VISUAL_DIFF close_changed=%d close_mean=%.6f far_changed=%d far_mean=%.6f" % [
		close_metrics.changed,
		close_metrics.mean_delta,
		far_metrics.changed,
		far_metrics.mean_delta,
	])

	if close_metrics.changed < 40 or close_metrics.mean_delta <= 0.00005:
		_fail("Close visual proof did not show a measurable tint change")
		return
	if far_metrics.changed < 10 or far_metrics.mean_delta <= 0.00001:
		_fail("Far visual proof did not show a measurable tint change")
		return

	print("TERRAIN_POLISH_ITERATION_04_VISUAL_PROOF_OK dir=%s" % output_dir)
	quit(0)


func _prepare_proof_maps(data) -> void:
	var splat: Image = data.call("get_image", HTerrainData.CHANNEL_SPLAT, 0)
	var detail: Image = data.call("get_image", HTerrainData.CHANNEL_DETAIL, 0)
	if splat == null or detail == null:
		_fail("Splat or detail image is unavailable")
		return

	var width := splat.get_width()
	var height := splat.get_height()
	for y in height:
		for x in width:
			var u := float(x) / float(maxi(width - 1, 1))
			var earth_weight := smoothstep(0.38, 0.62, u)
			splat.set_pixel(x, y, Color(1.0 - earth_weight, earth_weight, 0.0, 0.0))
	detail.fill(Color(0.82, 0.0, 0.0, 1.0))

	data.call("notify_region_change", Rect2(0, 0, width, height), HTerrainData.CHANNEL_SPLAT)
	data.call("notify_region_change", Rect2(0, 0, detail.get_width(), detail.get_height()), HTerrainData.CHANNEL_DETAIL)


func _bake_global_map() -> void:
	var baker := HTGlobalMapBaker.new()
	_scene_root.add_child(baker)
	var finished := false
	baker.progress_notified.connect(func(info):
		if bool(info.get("finished", false)):
			finished = true
	)
	baker.bake(_terrain)

	for _frame in 360:
		await process_frame
		if finished:
			break
	if not finished:
		baker.queue_free()
		_fail("HTerrain global-map bake timed out")
		return

	var data = _terrain.call("get_data")
	if int(data.call("get_map_count", HTerrainData.CHANNEL_GLOBAL_ALBEDO)) < 1:
		_fail("HTerrain global-map bake produced no global albedo map")
		return
	var global_map: Image = data.call("get_image", HTerrainData.CHANNEL_GLOBAL_ALBEDO, 0)
	if global_map == null or global_map.is_empty():
		_fail("HTerrain global albedo image is empty")
		return


func _set_tint(bottom: float, top: float) -> void:
	_detail_layer.call("set_shader_param", "u_globalmap_tint_bottom", bottom)
	_detail_layer.call("set_shader_param", "u_globalmap_tint_top", top)


func _capture(position: Vector3, target: Vector3, output_path: String) -> Image:
	_camera.position = position
	_camera.look_at(target, Vector3.UP)
	_detail_layer.call("process", 0.016, _camera.global_position)
	for _frame in 8:
		await process_frame
	await RenderingServer.frame_post_draw
	var image := root.get_texture().get_image()
	if image == null or image.is_empty():
		_fail("Viewport capture is empty: %s" % output_path)
		return null
	var save_error := image.save_png(output_path)
	if save_error != OK:
		_fail("Could not save visual proof image: %s" % output_path)
		return null
	return image


func _difference_metrics(before: Image, after: Image) -> Dictionary:
	if before.get_size() != after.get_size():
		return {"changed": 0, "mean_delta": 0.0}
	var changed := 0
	var delta_sum := 0.0
	var samples := 0
	for y in range(0, before.get_height(), 3):
		for x in range(0, before.get_width(), 3):
			var a := before.get_pixel(x, y)
			var b := after.get_pixel(x, y)
			var delta := absf(a.r - b.r) + absf(a.g - b.g) + absf(a.b - b.b)
			delta_sum += delta
			samples += 1
			if delta > 0.015:
				changed += 1
	return {
		"changed": changed,
		"mean_delta": delta_sum / float(maxi(samples, 1)),
	}


func _fail(message: String) -> void:
	push_error("TERRAIN_POLISH_ITERATION_04_VISUAL_PROOF_FAIL: %s" % message)
	quit(1)
