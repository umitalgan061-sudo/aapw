@tool
extends Node

const HTerrainData = preload("res://addons/zylann.hterrain/hterrain_data.gd")
const NORMAL_TILE_SIZE := 64

var _bound_data: HTerrainData = null


func _enter_tree() -> void:
	if not Engine.is_editor_hint():
		set_process(false)
		return
	set_process(true)
	call_deferred("_refresh_binding")


func _exit_tree() -> void:
	_unbind_data()


func _process(_delta: float) -> void:
	_refresh_binding()


func _refresh_binding() -> void:
	var terrain := get_parent()
	if terrain == null or not terrain.has_method("get_data"):
		_unbind_data()
		return

	var current_data = terrain.call("get_data") as HTerrainData
	if current_data == _bound_data:
		return

	_unbind_data()
	_bound_data = current_data
	if _bound_data != null and not _bound_data.region_changed.is_connected(_on_region_changed):
		_bound_data.region_changed.connect(_on_region_changed)


func _unbind_data() -> void:
	if _bound_data != null and _bound_data.region_changed.is_connected(_on_region_changed):
		_bound_data.region_changed.disconnect(_on_region_changed)
	_bound_data = null


func _on_region_changed(
	min_x: int,
	min_y: int,
	size_x: int,
	size_y: int,
	map_type: int
) -> void:
	if map_type != HTerrainData.CHANNEL_HEIGHT or size_x <= 0 or size_y <= 0:
		return

	var terrain := get_parent()
	if terrain == null:
		return

	var baker = terrain.get("_normals_baker")
	if baker == null or not baker.is_inside_tree():
		return

	var resolution := _bound_data.get_resolution() if _bound_data != null else 0
	if resolution <= 0:
		return

	var min_pixel_x := clampi(min_x - 1, 0, resolution - 1)
	var min_pixel_y := clampi(min_y - 1, 0, resolution - 1)
	var max_pixel_x := clampi(min_x + size_x, 0, resolution - 1)
	var max_pixel_y := clampi(min_y + size_y, 0, resolution - 1)

	var min_tile_x := floori(float(min_pixel_x) / float(NORMAL_TILE_SIZE))
	var min_tile_y := floori(float(min_pixel_y) / float(NORMAL_TILE_SIZE))
	var max_tile_x := floori(float(max_pixel_x) / float(NORMAL_TILE_SIZE))
	var max_tile_y := floori(float(max_pixel_y) / float(NORMAL_TILE_SIZE))

	for tile_y in range(min_tile_y, max_tile_y + 1):
		for tile_x in range(min_tile_x, max_tile_x + 1):
			baker.call("_request_tile", Vector2i(tile_x, tile_y))
