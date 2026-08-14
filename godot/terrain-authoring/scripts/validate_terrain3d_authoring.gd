extends SceneTree
## Headless validation for the Westeros Terrain3D authoring pipeline (DECISIONS.md ADR-0266).
##
## This is the round-trip proof the workspace is actually carrying the shipped game's world, not just
## "a Godot project that opens": it loads the saved region data back off disk and re-samples it
## through Terrain3D's own `Terrain3DData.get_height()`, then compares those heights against the
## values `scripts/exportWesterosHeightField.js` recorded straight from the live
## `src/3d/world/terrain.js` sampler at the 14 kingdom seats.
##
## Checks:
##   1. Terrain3D GDExtension loads and the authoring scene instantiates.
##   2. Region grid matches the manifest (count, region_size, vertex_spacing, world extent).
##   3. Terrain height range matches the exporter's own min/max.
##   4. Every kingdom seat's authored height matches the JS sampler within SEAT_TOLERANCE_METERS.
##   5. Every kingdom seat is above water — the same world-safety invariant
##      `scripts/terrainSeatSafetyCheck.js` enforces on the Three.js side (GOVERNANCE.md §8.4).
##
## Usage: godot --headless --path godot/terrain3d-authoring \
##            --script res://scripts/validate_terrain3d_authoring.gd

const MANIFEST_PATH := "res://source_data/westeros_height_r32.json"
const SCENE_PATH := "res://scenes/westeros_terrain3d_authoring.tscn"

## Seats sit on flattened settlement pads (ADR-0118) and are sampled between 4m grid vertices, so a
## small bilinear-interpolation delta against the continuous JS sampler is expected and fine. This
## bound is far tighter than the ~1.975m smallest real seat clearance above water, so a genuine
## import/scale/offset bug could not hide underneath it.
const SEAT_TOLERANCE_METERS := 0.25

var _terrain: Terrain3D
var _exit_code := 1
var _done := false
var _failures: Array[String] = []


func _initialize() -> void:
	if not ClassDB.class_exists("Terrain3D"):
		printerr("[validate_terrain3d_authoring] Terrain3D GDExtension is not loaded — check addons/terrain_3d/bin/ binaries.")
		_done = true
		return
	var packed: PackedScene = load(SCENE_PATH)
	if packed == null:
		printerr("[validate_terrain3d_authoring] Cannot load %s — run the import script first." % SCENE_PATH)
		_done = true
		return
	_terrain = packed.instantiate()
	root.add_child(_terrain)
	_attach_headless_camera()


func _process(_delta: float) -> bool:
	if _done:
		quit(_exit_code)
		return true
	_done = true
	_exit_code = _validate()
	if _exit_code == 0:
		print("[validate_terrain3d_authoring] PASS")
	else:
		for failure in _failures:
			printerr("  FAIL: %s" % failure)
		printerr("[validate_terrain3d_authoring] FAIL (%d problem(s))" % _failures.size())
	quit(_exit_code)
	return true


func _fail(message: String) -> void:
	_failures.append(message)


func _validate() -> int:
	if _terrain == null or _terrain.data == null:
		_fail("Terrain3D node has no Terrain3DData")
		return 1

	var manifest := _load_manifest()
	if manifest.is_empty():
		_fail("manifest %s unreadable" % MANIFEST_PATH)
		return 1

	var data := _terrain.data

	# 2. Region grid matches the manifest.
	var expected_regions := int(manifest.regionsX) * int(manifest.regionsZ)
	if data.get_region_count() != expected_regions:
		_fail("region count %d != manifest %d" % [data.get_region_count(), expected_regions])
	if _terrain.region_size != int(manifest.regionSize):
		_fail("region_size %d != manifest %d" % [_terrain.region_size, int(manifest.regionSize)])
	if not is_equal_approx(_terrain.vertex_spacing, float(manifest.vertexSpacing)):
		_fail("vertex_spacing %f != manifest %f" % [_terrain.vertex_spacing, float(manifest.vertexSpacing)])

	var region_span: float = float(manifest.regionSize) * float(manifest.vertexSpacing)
	var covered_width: float = float(manifest.regionsX) * region_span
	var covered_depth: float = float(manifest.regionsZ) * region_span
	if covered_width < float(manifest.worldWidthMeters):
		_fail("authored width %.1fm does not cover world width %.1fm" % [covered_width, float(manifest.worldWidthMeters)])
	if covered_depth < float(manifest.worldDepthMeters):
		_fail("authored depth %.1fm does not cover world depth %.1fm" % [covered_depth, float(manifest.worldDepthMeters)])

	# 3. Height range matches the exporter.
	var height_range := data.get_height_range()
	var manifest_max := float(manifest.maxHeightMeters)
	if absf(height_range.y - manifest_max) > SEAT_TOLERANCE_METERS:
		_fail("max height %.3fm != manifest %.3fm" % [height_range.y, manifest_max])

	# 4 + 5. Kingdom seats: authored height matches the JS sampler, and stays above water.
	var water_level := float(manifest.waterLevelMeters)
	var seats: Array = manifest.get("seats", [])
	if seats.is_empty():
		_fail("manifest carries no kingdom seats to verify against")
	var worst_delta := 0.0
	var worst_seat := ""
	for seat_variant in seats:
		var seat: Dictionary = seat_variant
		var seat_id: String = str(seat.id)
		var position := Vector3(float(seat.x), 0.0, float(seat.z))
		var authored := data.get_height(position)
		var expected := float(seat.heightMeters)
		if not is_finite(authored):
			_fail("seat %s sampled a non-finite height (is it outside every region?)" % seat_id)
			continue
		var delta: float = absf(authored - expected)
		if delta > worst_delta:
			worst_delta = delta
			worst_seat = seat_id
		if delta > SEAT_TOLERANCE_METERS:
			_fail("seat %s authored %.3fm vs JS sampler %.3fm (delta %.3fm > %.3fm)"
				% [seat_id, authored, expected, delta, SEAT_TOLERANCE_METERS])
		if authored <= water_level:
			_fail("seat %s is at/below water level (%.3fm <= %.3fm)" % [seat_id, authored, water_level])

	if _failures.is_empty():
		print("[validate_terrain3d_authoring] %d regions of %d @ %.2fm covering %.0fx%.0fm; height %.3f..%.3fm; %d/%d seats above %.1fm water; worst seat delta %.3fm (%s)"
			% [data.get_region_count(), _terrain.region_size, _terrain.vertex_spacing,
				covered_width, covered_depth, height_range.x, height_range.y,
				seats.size(), seats.size(), water_level, worst_delta, worst_seat])
		return 0
	return 1


func _load_manifest() -> Dictionary:
	if not FileAccess.file_exists(MANIFEST_PATH):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(MANIFEST_PATH))
	if typeof(parsed) != TYPE_DICTIONARY:
		return {}
	return parsed


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
