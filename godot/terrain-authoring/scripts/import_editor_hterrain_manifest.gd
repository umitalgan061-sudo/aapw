extends SceneTree

const HTerrainData = preload("res://addons/zylann.hterrain/hterrain_data.gd")

const DEFAULT_SOURCE := "res://terrain_data"
const DEFAULT_MANIFEST := "res://editor_bridge/map_reference_seed.json"
const DEFAULT_OUTPUT := "res://editor_bridge/generated_terrain_data"
const EXPECTED_SCHEMA := "westeros-hterrain-editor-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAP_RELIEF_METERS := 18.0
const CHAIN_RELIEF_METERS := 26.0
const CHAIN_RADIUS := Vector2(0.020, 0.030)


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


func _read_manifest(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		_fail("HTerrain editor manifest does not exist: %s" % path)
		return {}
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		_fail("HTerrain editor manifest could not be opened: %s" % path)
		return {}
	var parsed = JSON.parse_string(file.get_as_text())
	if typeof(parsed) != TYPE_DICTIONARY:
		_fail("HTerrain editor manifest must be a JSON object")
		return {}
	return parsed


func _validate_manifest(manifest: Dictionary, resolution: int) -> bool:
	if str(manifest.get("schema", "")) != EXPECTED_SCHEMA:
		_fail("Unsupported HTerrain editor schema")
		return false
	if str(manifest.get("mapReferenceSha256", "")) != EXPECTED_MAP_SHA:
		_fail("HTerrain editor manifest is not locked to canonical map.png")
		return false
	if not bool(manifest.get("mapLocked", false)):
		_fail("HTerrain editor manifest must keep mapLocked=true")
		return false
	if int(manifest.get("hterrainResolution", 0)) != resolution:
		_fail("HTerrain editor manifest resolution drifted from source data")
		return false
	var reference_canvas = manifest.get("referenceCanvas", {})
	if typeof(reference_canvas) != TYPE_DICTIONARY \
	or int(reference_canvas.get("width", 0)) != 9000 \
	or int(reference_canvas.get("height", 0)) != 7000:
		_fail("HTerrain editor manifest reference canvas must remain 9000x7000")
		return false
	return true


func _smooth_influence(uv: Vector2, center: Vector2, radius: Vector2) -> float:
	if radius.x <= 0.0 or radius.y <= 0.0:
		return 0.0
	var dx := (uv.x - center.x) / radius.x
	var dy := (uv.y - center.y) / radius.y
	var distance := sqrt(dx * dx + dy * dy)
	if distance >= 1.0:
		return 0.0
	var t := 1.0 - distance
	return t * t * (3.0 - 2.0 * t)


func _surface_target(kind: String) -> Color:
	match kind:
		"snow":
			return Color(0.02, 0.03, 0.10, 0.85)
		"mountain", "rocky-hills", "rock":
			return Color(0.08, 0.14, 0.78, 0.0)
		"desert", "arid", "earth":
			return Color(0.12, 0.82, 0.06, 0.0)
		"marsh":
			return Color(0.68, 0.28, 0.04, 0.0)
		"jungle":
			return Color(0.86, 0.10, 0.04, 0.0)
		"steppe":
			return Color(0.72, 0.24, 0.04, 0.0)
		_:
			return Color(0.88, 0.09, 0.03, 0.0)


func _normalized_splat(color: Color) -> Color:
	var r := maxf(0.0, color.r)
	var g := maxf(0.0, color.g)
	var b := maxf(0.0, color.b)
	var a := maxf(0.0, color.a)
	var total := r + g + b + a
	if total <= 0.000001:
		return Color(1.0, 0.0, 0.0, 0.0)
	return Color(r / total, g / total, b / total, a / total)


func _blend_splat(current: Color, target: Color, amount: float) -> Color:
	return _normalized_splat(current.lerp(target, clampf(amount, 0.0, 1.0)))


func _apply_map_reference(height_image: Image, splat_image: Image, manifest: Dictionary) -> int:
	if not bool(manifest.get("applyMapReference", false)):
		return 0
	var zones = manifest.get("biomeZones", [])
	var chains = manifest.get("reliefChains", [])
	if typeof(zones) != TYPE_ARRAY or typeof(chains) != TYPE_ARRAY:
		_fail("HTerrain map reference zones/chains must be arrays")
		return 0
	var resolution := height_image.get_width()
	var changed := 0
	for y in range(resolution):
		var uv_y := float(y) / float(resolution - 1)
		for x in range(resolution):
			var uv := Vector2(float(x) / float(resolution - 1), uv_y)
			var height_delta := 0.0
			var splat := splat_image.get_pixel(x, y)
			var touched := false
			for zone_value in zones:
				if typeof(zone_value) != TYPE_DICTIONARY:
					continue
				var center_values = zone_value.get("center", [])
				var radius_values = zone_value.get("radius", [])
				if center_values.size() != 2 or radius_values.size() != 2:
					continue
				var influence := _smooth_influence(
					uv,
					Vector2(float(center_values[0]), float(center_values[1])),
					Vector2(float(radius_values[0]), float(radius_values[1])))
				if influence <= 0.0:
					continue
				var kind := str(zone_value.get("kind", "grass"))
				var elevation_bias := float(zone_value.get("elevationBias", 0.0))
				height_delta += elevation_bias * MAP_RELIEF_METERS * influence
				splat = _blend_splat(splat, _surface_target(kind), influence * 0.78)
				touched = true
			for chain_value in chains:
				if typeof(chain_value) != TYPE_DICTIONARY:
					continue
				for point_values in chain_value.get("points", []):
					if point_values.size() != 2:
						continue
					var chain_influence := _smooth_influence(
						uv,
						Vector2(float(point_values[0]), float(point_values[1])),
						CHAIN_RADIUS)
					if chain_influence <= 0.0:
						continue
					height_delta += CHAIN_RELIEF_METERS * chain_influence
					splat = _blend_splat(splat, _surface_target("mountain"), chain_influence * 0.88)
					touched = true
			if touched:
				var base_height := height_image.get_pixel(x, y).r
				height_image.set_pixel(x, y, Color(base_height + height_delta, 0.0, 0.0, 1.0))
				splat_image.set_pixel(x, y, splat)
				changed += 1
	return changed


func _apply_strokes(height_image: Image, splat_image: Image, manifest: Dictionary) -> int:
	var strokes = manifest.get("strokes", [])
	if typeof(strokes) != TYPE_ARRAY:
		_fail("HTerrain editor strokes must be an array")
		return 0
	var resolution := height_image.get_width()
	var changed := 0
	for stroke_value in strokes:
		if typeof(stroke_value) != TYPE_DICTIONARY:
			continue
		var uv_values = stroke_value.get("uv", [])
		var radius_values = stroke_value.get("radiusUv", [])
		if uv_values.size() != 2 or radius_values.size() != 2:
			continue
		var center := Vector2(float(uv_values[0]), float(uv_values[1]))
		var radius := Vector2(maxf(float(radius_values[0]), 1.0 / float(resolution - 1)), maxf(float(radius_values[1]), 1.0 / float(resolution - 1)))
		if center.x < 0.0 or center.x > 1.0 or center.y < 0.0 or center.y > 1.0:
			_fail("HTerrain editor stroke escaped canonical map bounds")
			return changed
		var delta_meters := clampf(float(stroke_value.get("heightDeltaMeters", 0.0)), -20.0, 20.0)
		var surface := str(stroke_value.get("surface", "grass"))
		var surface_blend := clampf(float(stroke_value.get("surfaceBlend", 0.65)), 0.0, 1.0)
		var min_x := maxi(0, int(floor((center.x - radius.x) * float(resolution - 1))))
		var max_x := mini(resolution - 1, int(ceil((center.x + radius.x) * float(resolution - 1))))
		var min_y := maxi(0, int(floor((center.y - radius.y) * float(resolution - 1))))
		var max_y := mini(resolution - 1, int(ceil((center.y + radius.y) * float(resolution - 1))))
		for y in range(min_y, max_y + 1):
			for x in range(min_x, max_x + 1):
				var uv := Vector2(float(x) / float(resolution - 1), float(y) / float(resolution - 1))
				var influence := _smooth_influence(uv, center, radius)
				if influence <= 0.0:
					continue
				var base_height := height_image.get_pixel(x, y).r
				height_image.set_pixel(x, y, Color(base_height + delta_meters * influence, 0.0, 0.0, 1.0))
				splat_image.set_pixel(x, y, _blend_splat(splat_image.get_pixel(x, y), _surface_target(surface), surface_blend * influence))
				changed += 1
	return changed


func _run() -> void:
	var source := _arg_value("--source=", DEFAULT_SOURCE)
	var manifest_path := _arg_value("--manifest=", DEFAULT_MANIFEST)
	var output := _arg_value("--output=", DEFAULT_OUTPUT)
	var data = HTerrainData.new()
	data.load_data(source)
	var resolution: int = data.get_resolution()
	if resolution <= 0:
		_fail("HTerrain source data could not be loaded: %s" % source)
		return
	var manifest := _read_manifest(manifest_path)
	if not _validate_manifest(manifest, resolution):
		return
	var height_image := data.get_image(HTerrainData.CHANNEL_HEIGHT)
	var splat_image := data.get_image(HTerrainData.CHANNEL_SPLAT)
	if height_image == null or splat_image == null:
		_fail("HTerrain height/splat images are unavailable")
		return
	if height_image.get_format() != Image.FORMAT_RF or splat_image.get_format() != Image.FORMAT_RGBA8:
		_fail("HTerrain height/splat formats drifted")
		return
	var map_cells := _apply_map_reference(height_image, splat_image, manifest)
	var stroke_cells := _apply_strokes(height_image, splat_image, manifest)
	data.notify_full_change()
	var absolute_output := ProjectSettings.globalize_path(output)
	var directory_error := DirAccess.make_dir_recursive_absolute(absolute_output)
	if directory_error != OK:
		_fail("HTerrain output directory could not be created: %s" % directory_error)
		return
	if not data.save_data(output):
		_fail("HTerrain editor output could not be saved: %s" % output)
		return
	print("HTERRAIN_EDITOR_IMPORT_OK resolution=%s map_cells=%s stroke_cells=%s source=%s output=%s" % [resolution, map_cells, stroke_cells, source, output])
	quit(0)
