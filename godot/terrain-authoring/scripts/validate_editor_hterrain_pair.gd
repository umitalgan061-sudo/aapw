extends SceneTree

const HTerrainData = preload("res://addons/zylann.hterrain/hterrain_data.gd")
const DEFAULT_A := "res://editor_bridge/ci_generated_a"
const DEFAULT_B := "res://editor_bridge/ci_generated_b"
const CHANNELS := [
	HTerrainData.CHANNEL_HEIGHT,
	HTerrainData.CHANNEL_NORMAL,
	HTerrainData.CHANNEL_COLOR,
	HTerrainData.CHANNEL_SPLAT,
	HTerrainData.CHANNEL_DETAIL,
	HTerrainData.CHANNEL_GLOBAL_ALBEDO,
]


func _init() -> void:
	call_deferred("_run")


func _fail(message: String) -> void:
	push_error(message)
	quit(1)


func _arg_value(prefix: String, fallback: String) -> String:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with(prefix):
			return arg.substr(prefix.length())
	return fallback


func _run() -> void:
	if not Engine.is_editor_hint():
		_fail("HTerrain semantic pair validation must run with --editor")
		return
	var path_a := _arg_value("--a=", DEFAULT_A)
	var path_b := _arg_value("--b=", DEFAULT_B)
	var a = HTerrainData.new()
	var b = HTerrainData.new()
	a.load_data(path_a)
	b.load_data(path_b)
	if a.get_resolution() <= 0 or b.get_resolution() <= 0:
		_fail("HTerrain pair could not be loaded")
		return
	if a.get_resolution() != b.get_resolution():
		_fail("HTerrain pair resolution mismatch")
		return
	var compared_maps := 0
	var compared_bytes := 0
	for channel in CHANNELS:
		var count_a: int = a.get_map_count(channel)
		var count_b: int = b.get_map_count(channel)
		if count_a != count_b:
			_fail("HTerrain channel %s map-count mismatch: %s vs %s" % [channel, count_a, count_b])
			return
		for index in range(count_a):
			var image_a: Image = a.get_image(channel, index)
			var image_b: Image = b.get_image(channel, index)
			if image_a == null or image_b == null:
				_fail("HTerrain channel %s index %s image unavailable" % [channel, index])
				return
			if image_a.get_size() != image_b.get_size() or image_a.get_format() != image_b.get_format():
				_fail("HTerrain channel %s index %s image shape/format mismatch" % [channel, index])
				return
			var bytes_a := image_a.get_data()
			var bytes_b := image_b.get_data()
			if bytes_a != bytes_b:
				_fail("HTerrain channel %s index %s semantic bytes differ" % [channel, index])
				return
			compared_maps += 1
			compared_bytes += bytes_a.size()
	print("HTERRAIN_EDITOR_PAIR_OK resolution=%s maps=%s bytes=%s a=%s b=%s" % [
		a.get_resolution(),
		compared_maps,
		compared_bytes,
		path_a,
		path_b,
	])
	quit(0)
