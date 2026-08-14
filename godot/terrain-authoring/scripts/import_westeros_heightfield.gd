extends SceneTree
## Imports the exported Westeros height field into Terrain3D region data.
##
## Input is produced by `scripts/exportWesterosHeightField.js` (repo root): a raw little-endian
## Float32 heightmap plus a JSON manifest describing its geometry. That exporter samples the *live*
## `src/3d/world/terrain.js` height field, so the terrain authored here starts as an exact copy of
## the world the shipped Three.js game renders — not an unrelated blank slate a human would have to
## re-sculpt from scratch to match.
##
## The call shape (Array[Image] sized to TYPE_MAX, indexed by Terrain3DRegion.TYPE_HEIGHT, then
## `data.import_images(images, Vector3(x, 0, z), offset, scale)` followed by `data.save_directory()`)
## mirrors the addon's own `addons/terrain_3d/tools/importer.gd`, so this stays on Terrain3D's
## supported import path rather than writing region resources by hand.
##
## Work happens on the first processed frame, not in `_initialize()`: Terrain3D allocates its
## `Terrain3DData` (and accepts `region_size`) only once the tree is actually running, so a
## `_initialize()`-time import would see `data == null` and silently no-op.
##
## Usage: godot --headless --path godot/terrain3d-authoring \
##            --script res://scripts/import_westeros_heightfield.gd

const MANIFEST_PATH := "res://source_data/westeros_height_r32.json"
# Deliberately NOT `res://terrain_data` — that belongs to the HTerrain engine already living in
# this project. Terrain3D gets its own directory so the two authoring backends never overwrite each
# other's data (see TERRAIN_AUTOMATION_RULES.md: HTerrain is preserved for regression).
const DATA_DIRECTORY := "res://terrain3d_data"
const SCENE_DIRECTORY := "res://scenes"
const SCENE_PATH := "res://scenes/westeros_terrain3d_authoring.tscn"

var _terrain: Terrain3D
var _exit_code := 1
var _done := false


func _initialize() -> void:
	if not ClassDB.class_exists("Terrain3D"):
		printerr("[import_westeros_heightfield] Terrain3D GDExtension is not loaded — check addons/terrain_3d/bin/ binaries.")
		_done = true
		return
	_terrain = ClassDB.instantiate("Terrain3D")
	_terrain.name = "Terrain3D"
	root.add_child(_terrain)
	_attach_headless_camera()


func _process(_delta: float) -> bool:
	if _done:
		return true
	_done = true
	_exit_code = _import()
	if _exit_code == 0:
		print("[import_westeros_heightfield] PASS")
	else:
		printerr("[import_westeros_heightfield] FAIL")
	# `quit(code)` is what actually propagates a non-zero status to CI — returning true alone ends
	# the loop with status 0 and would report a failed import as success.
	quit(_exit_code)
	return true


func _import() -> int:
	if _terrain == null or _terrain.data == null:
		printerr("Terrain3D node has no Terrain3DData — extension loaded but terrain failed to initialize.")
		return 1

	var manifest := _load_manifest()
	if manifest.is_empty():
		return 1

	var height_image := _load_height_image(manifest)
	if height_image == null:
		return 1

	# Create the data directory before assigning `data_directory`: Terrain3D immediately scans it for
	# existing regions and logs "Cannot open directory" if it is missing.
	var absolute_dir := ProjectSettings.globalize_path(DATA_DIRECTORY)
	if not DirAccess.dir_exists_absolute(absolute_dir):
		DirAccess.make_dir_recursive_absolute(absolute_dir)

	_terrain.region_size = int(manifest.regionSize)
	_terrain.vertex_spacing = float(manifest.vertexSpacing)
	_terrain.data_directory = DATA_DIRECTORY
	# Terrain3D warns on every load when this is on without a saved Terrain3DAssets resource. No
	# texture assets exist yet (texturing is a later step — the terrain currently renders with
	# Terrain3D's built-in checker/grey debug material), so turn it off rather than ship a workspace
	# that warns on startup — GOVERNANCE.md §8.1's console-cleanliness rule applies here too.
	_terrain.free_editor_textures = false
	if _terrain.region_size != int(manifest.regionSize):
		printerr("region_size did not apply: got %d, manifest wants %d" % [_terrain.region_size, int(manifest.regionSize)])
		return 1

	var images: Array[Image] = []
	images.resize(Terrain3DRegion.TYPE_MAX)
	images[Terrain3DRegion.TYPE_HEIGHT] = height_image

	var origin := Vector3(float(manifest.originX), 0.0, float(manifest.originZ))
	print("[import_westeros_heightfield] importing %dx%d vertices at origin %s, region_size=%d, vertex_spacing=%.2fm"
		% [height_image.get_width(), height_image.get_height(), origin, _terrain.region_size, _terrain.vertex_spacing])
	_terrain.data.import_images(images, origin, 0.0, 1.0)

	var expected_regions := int(manifest.regionsX) * int(manifest.regionsZ)
	var region_count := _terrain.data.get_region_count()
	if region_count != expected_regions:
		printerr("region count %d != expected %d" % [region_count, expected_regions])
		return 1

	_terrain.data.save_directory(DATA_DIRECTORY)

	var height_range := _terrain.data.get_height_range()
	print("[import_westeros_heightfield] %d regions saved to %s, height range %.3f..%.3fm"
		% [region_count, DATA_DIRECTORY, height_range.x, height_range.y])

	return _save_authoring_scene()


## Writes the human-facing authoring scene from the same configured node this import just used, so
## the scene can never drift from the region data's own region_size/vertex_spacing/data_directory.
func _save_authoring_scene() -> int:
	var scene_dir := ProjectSettings.globalize_path(SCENE_DIRECTORY)
	if not DirAccess.dir_exists_absolute(scene_dir):
		DirAccess.make_dir_recursive_absolute(scene_dir)

	var packed := PackedScene.new()
	var pack_error := packed.pack(_terrain)
	if pack_error != OK:
		printerr("Cannot pack authoring scene: %s" % error_string(pack_error))
		return 1
	var save_error := ResourceSaver.save(packed, SCENE_PATH)
	if save_error != OK:
		printerr("Cannot save %s: %s" % [SCENE_PATH, error_string(save_error)])
		return 1
	print("[import_westeros_heightfield] authoring scene saved to %s" % SCENE_PATH)
	return 0


func _load_manifest() -> Dictionary:
	if not FileAccess.file_exists(MANIFEST_PATH):
		printerr("Missing %s — run `node scripts/exportWesterosHeightField.js` from the repo root first."
			% MANIFEST_PATH)
		return {}
	var text := FileAccess.get_file_as_string(MANIFEST_PATH)
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		printerr("Manifest %s is not a JSON object" % MANIFEST_PATH)
		return {}
	var manifest: Dictionary = parsed
	for key in ["binFile", "width", "height", "regionSize", "vertexSpacing", "originX", "originZ", "regionsX", "regionsZ", "byteLength"]:
		if not manifest.has(key):
			printerr("Manifest is missing required key '%s'" % key)
			return {}
	return manifest


func _load_height_image(manifest: Dictionary) -> Image:
	var bin_path: String = "res://source_data/%s" % manifest.binFile
	if not FileAccess.file_exists(bin_path):
		printerr("Missing %s — run `node scripts/exportWesterosHeightField.js` from the repo root first."
			% bin_path)
		return null

	var file := FileAccess.open(bin_path, FileAccess.READ)
	if file == null:
		printerr("Cannot open %s: %s" % [bin_path, error_string(FileAccess.get_open_error())])
		return null
	var bytes := file.get_buffer(file.get_length())
	file.close()

	var width := int(manifest.width)
	var height := int(manifest.height)
	var expected := width * height * 4
	if bytes.size() != expected:
		printerr("Height buffer is %d bytes, manifest says %d (%dx%d float32)"
			% [bytes.size(), expected, width, height])
		return null
	if int(manifest.byteLength) != bytes.size():
		printerr("Height buffer size %d disagrees with manifest byteLength %d"
			% [bytes.size(), int(manifest.byteLength)])
		return null

	# FORMAT_RF is Terrain3D's height map format — a straight reinterpretation of the raw float32
	# buffer, so no quantization happens anywhere between the JS sampler and the region data.
	return Image.create_from_data(width, height, false, Image.FORMAT_RF, bytes)


## Terrain3D drives its clipmap from an active camera and logs an error when it cannot find one.
## Headless runs have no viewport camera, so give it an explicit one; it is added to `root` rather
## than under the terrain so it never becomes part of the saved authoring scene (the Godot editor
## supplies its own camera when a human opens that scene).
func _attach_headless_camera() -> void:
	var camera := Camera3D.new()
	camera.name = "HeadlessCamera"
	camera.current = true
	root.add_child(camera)
	_terrain.set_camera(camera)
