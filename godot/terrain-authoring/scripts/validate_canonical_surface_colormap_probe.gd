extends SceneTree

const PROBE_DIRECTORY := "res://.generated/iteration_011"
const TGA_PATH := PROBE_DIRECTORY + "/canonical_surface_colormap.tga"
const PNG_PATH := PROBE_DIRECTORY + "/canonical_surface_colormap.png"
const REPORT_PATH := PROBE_DIRECTORY + "/canonical_surface_colormap.json"
const WIDTH := 96
const HEIGHT := 64
const SOURCE_MAP_SHA256 := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const EXPECTED_COUNTS := {
	"sea": 4046,
	"lake": 6,
	"soil": 1638,
	"rock": 323,
	"snow": 131,
}
const PALETTE := {
	"sea": Color8(0x29, 0x4d, 0x5d, 0xff),
	"lake": Color8(0x4f, 0x7f, 0x86, 0xff),
	"soil": Color8(0x7d, 0x87, 0x58, 0xff),
	"rock": Color8(0x75, 0x6c, 0x60, 0xff),
	"snow": Color8(0xd8, 0xdf, 0xdc, 0xff),
}


func _init() -> void:
	call_deferred("_run_validation")


func _fail(message: String) -> void:
	push_error(message)
	quit(1)


func _color_delta(left: Color, right: Color) -> float:
	return maxf(
		maxf(absf(left.r - right.r), absf(left.g - right.g)),
		maxf(absf(left.b - right.b), absf(left.a - right.a))
	)


func _classify_color(color: Color) -> String:
	var best_name := ""
	var best_delta := INF
	for surface in PALETTE:
		var delta := _color_delta(color, PALETTE[surface])
		if delta < best_delta:
			best_name = surface
			best_delta = delta
	if best_delta > (1.5 / 255.0):
		return ""
	return best_name


func _sha256_file(path: String) -> String:
	var context := HashingContext.new()
	var start_error := context.start(HashingContext.HASH_SHA256)
	if start_error != OK:
		return ""
	var bytes := FileAccess.get_file_as_bytes(ProjectSettings.globalize_path(path))
	if bytes.is_empty():
		return ""
	context.update(bytes)
	return context.finish().hex_encode()


func _run_validation() -> void:
	var report_text := FileAccess.get_file_as_string(ProjectSettings.globalize_path(REPORT_PATH))
	var report = JSON.parse_string(report_text)
	if not report is Dictionary:
		_fail("Canonical colormap report could not be parsed")
		return
	if report.get("sourceMapSha256", "") != SOURCE_MAP_SHA256:
		_fail("Canonical map.png SHA-256 provenance drifted")
		return

	var image := Image.load_from_file(ProjectSettings.globalize_path(TGA_PATH))
	if image == null or image.is_empty():
		_fail("Godot could not load the generated canonical TGA colormap")
		return
	if image.get_size() != Vector2i(WIDTH, HEIGHT):
		_fail("Canonical TGA dimensions drifted: %s" % image.get_size())
		return
	if image.get_format() != Image.FORMAT_RGBA8:
		_fail("Canonical TGA must import as RGBA8, got %s" % image.get_format())
		return

	var counts := {
		"sea": 0,
		"lake": 0,
		"soil": 0,
		"rock": 0,
		"snow": 0,
	}
	var alpha_failures := 0
	var unknown_colors := 0
	for y in range(HEIGHT):
		for x in range(WIDTH):
			var color := image.get_pixel(x, y)
			if color.a < 0.999:
				alpha_failures += 1
			var surface := _classify_color(color)
			if surface.is_empty():
				unknown_colors += 1
			else:
				counts[surface] += 1

	if alpha_failures != 0:
		_fail("Canonical colormap introduced non-opaque pixels: %s" % alpha_failures)
		return
	if unknown_colors != 0:
		_fail("Canonical colormap contains colors outside the approved semantic palette: %s" % unknown_colors)
		return
	for surface in EXPECTED_COUNTS:
		if counts[surface] != EXPECTED_COUNTS[surface]:
			_fail("Canonical %s count drifted: %s != %s" % [surface, counts[surface], EXPECTED_COUNTS[surface]])
			return

	var actual_sha256 := _sha256_file(TGA_PATH)
	if actual_sha256.is_empty() or actual_sha256 != report.get("tgaSha256", ""):
		_fail("Canonical TGA SHA-256 does not match exporter report")
		return

	var save_error := image.save_png(ProjectSettings.globalize_path(PNG_PATH))
	if save_error != OK:
		_fail("Godot could not persist the canonical PNG visual proof: %s" % save_error)
		return

	print("TERRAIN_POLISH_ITERATION_11_OK dimensions=%sx%s source_map_sha256=%s tga_sha256=%s counts=%s" % [
		WIDTH,
		HEIGHT,
		SOURCE_MAP_SHA256,
		actual_sha256,
		JSON.stringify(counts),
	])
	quit(0)
