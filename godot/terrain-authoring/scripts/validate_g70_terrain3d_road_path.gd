extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g70-road-path-probe.json"
const METRICS_PATH := "res://.terrain3d-proof/g70-road-path-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g70-road-path-imported-topdown.png"
const EXPECTED_POLICY := "safak-kartali-g70-terrain3d-road-path-2026-08-14-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const MAX_HEIGHT_ERROR := 0.001
const MAX_BLEND_ERROR := 0.000001

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G70 Terrain3D Road/Path proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _source_value(probe: Dictionary, channel: int, u: float, v: float) -> float:
	var rows: Array = probe["rows"]
	var gx := clampf(u, 0, 1) * float(SOURCE_SIZE - 1)
	var gy := clampf(v, 0, 1) * float(SOURCE_SIZE - 1)
	var x0 := int(floor(gx)); var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, SOURCE_SIZE - 1); var y1 := mini(y0 + 1, SOURCE_SIZE - 1)
	var tx := gx - float(x0); var ty := gy - float(y0)
	var a := float(rows[y0][x0][channel]); var b := float(rows[y0][x1][channel])
	var c := float(rows[y1][x0][channel]); var d := float(rows[y1][x1][channel])
	return lerpf(lerpf(a, b, tx), lerpf(c, d, tx), ty)

func _height_image(probe: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			image.set_pixel(x, z, Color(_source_value(probe, 0, float(x) / 256.0, float(z) / 256.0), 0, 0, 1))
	return image

func _control_image(probe: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	var base_id := int(probe["baseTextureId"]); var road_id := int(probe["roadTextureId"])
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var blend := int(round(clampf(_source_value(probe, 3, float(x) / 256.0, float(z) / 256.0), 0, 1) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(base_id) | Terrain3DUtil.enc_overlay(road_id) | Terrain3DUtil.enc_blend(blend)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0, 0, 1))
	return image

func _saved(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null: return {}
	var files: Array[String] = []; var bytes := 0
	dir.list_dir_begin(); var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			files.push_back(name); bytes += FileAccess.get_file_as_bytes(directory.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end(); files.sort()
	return {"files": files, "bytes": bytes}

func _write_preview(terrain: Terrain3D) -> bool:
	var image := Image.create_empty(256, 256, false, Image.FORMAT_RGBA8)
	for z in 256:
		for x in 256:
			var blend := terrain.data.get_control_blend(Vector3(float(x), 0, float(z)))
			if is_nan(blend): return false
			image.set_pixel(x, z, Color(0.11, 0.25, 0.31, 1).lerp(Color(0.40, 0.28, 0.18, 1), clampf(blend, 0, 1)))
	var absolute := ProjectSettings.globalize_path(PREVIEW_PATH)
	DirAccess.make_dir_recursive_absolute(absolute.get_base_dir())
	return image.save_png(PREVIEW_PATH) == OK

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON invalid"): return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected policy"): return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "map SHA changed"): return
	if not _require(int(probe["probeGridSize"]) == SOURCE_SIZE, "probe must remain 65x65"): return
	if not _require(int(probe["terrain3dImportSize"]) == IMPORT_SIZE and int(probe["terrain3dRegionSize"]) == REGION_SIZE, "expected 257/256 import contract"): return
	if not _require(probe["crossingEdges"].size() == 0, "runtime road crossing entered G70"): return
	for row in probe["rows"]:
		for s in row:
			if not _require(float(s[0]) < 0, "Road/Path source left submerged seafloor"): return
			if not _require(absf(float(s[1])) <= MAX_BLEND_ERROR and absf(float(s[2])) <= MAX_BLEND_ERROR, "source invented road/path coverage"): return
			if not _require(absf(float(s[3])) <= MAX_BLEND_ERROR and int(s[4]) == 0, "source invented road/path control"): return

	var terrain := Terrain3D.new(); terrain.name = "G70Terrain3DRoadPathProof"; get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	terrain.data.import_images([_height_image(probe), _control_image(probe), null], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 4, "real 257x257 import did not create four regions"): return

	var max_height_error := 0.0; var max_blend := 0.0; var aligned := 0
	for sy in SOURCE_SIZE:
		for sx in SOURCE_SIZE:
			var pos := Vector3(float(sx * 4), 0, float(sy * 4))
			var actual := terrain.data.get_height(pos)
			if not _require(not is_nan(actual), "aligned height NaN"): return
			max_height_error = maxf(max_height_error, absf(actual - _source_value(probe, 0, float(sx) / 64.0, float(sy) / 64.0)))
			var blend := terrain.data.get_control_blend(pos)
			if not _require(not is_nan(blend), "aligned control NaN"): return
			max_blend = maxf(max_blend, absf(blend)); aligned += 1
	if not _require(max_height_error <= MAX_HEIGHT_ERROR, "height roundtrip exceeded tolerance"): return
	if not _require(max_blend <= MAX_BLEND_ERROR, "road control leaked onto G70 sea"): return

	var seam := [254.75, 255.0, 255.25, 255.5, 255.75, 256.0]
	var seam_samples := 0; var max_seam_height_error := 0.0; var max_seam_blend := 0.0
	for edge in seam:
		for cross in [32.25, 96.5, 160.75, 224.5, 256.0]:
			for pos in [Vector3(edge, 0, cross), Vector3(cross, 0, edge)]:
				var actual := terrain.data.get_height(pos)
				if not _require(not is_nan(actual), "seam height NaN"): return
				max_seam_height_error = maxf(max_seam_height_error, absf(actual - _source_value(probe, 0, pos.x / 256.0, pos.z / 256.0)))
				var blend := terrain.data.get_control_blend(pos)
				if not _require(not is_nan(blend), "seam control NaN"): return
				max_seam_blend = maxf(max_seam_blend, absf(blend)); seam_samples += 1
	if not _require(max_seam_height_error <= MAX_HEIGHT_ERROR and max_seam_blend <= MAX_BLEND_ERROR, "255/256 road seam drifted"): return

	var mesh: Mesh = terrain.bake_mesh(0)
	if not _require(mesh != null and mesh.get_surface_count() > 0, "LOD0 bake empty"): return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "LOD0 vertices empty"): return
	var suffix := OS.get_environment("G70_ROAD_PATH_PROOF_SUFFIX"); if suffix.is_empty(): suffix = "default"
	var out_dir := "user://g70-terrain3d-road-path-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(out_dir)); terrain.data.save_directory(out_dir)
	var saved := _saved(out_dir)
	if not _require(saved.get("files", []).size() >= 4 and int(saved.get("bytes", 0)) > 0, "region persistence missing"): return
	if not _require(_write_preview(terrain), "top-down preview failed"): return
	var metrics := {
		"terrain3dVersion": String(terrain.version), "regionSize": int(terrain.region_size), "regionCount": terrain.data.get_region_count(),
		"alignedSamples": aligned, "seamSamples": seam_samples, "maxHeightError": snappedf(max_height_error, 0.00000001),
		"maxActualBlend": snappedf(max_blend, 0.00000001), "maxSeamHeightError": snappedf(max_seam_height_error, 0.00000001),
		"maxSeamBlend": snappedf(max_seam_blend, 0.00000001), "bakedSurfaces": mesh.get_surface_count(), "bakedVertices": vertices.size(),
		"savedRegionFiles": saved["files"].size(), "savedRegionBytes": int(saved["bytes"]), "previewPath": PREVIEW_PATH,
	}
	var absolute := ProjectSettings.globalize_path(METRICS_PATH); DirAccess.make_dir_recursive_absolute(absolute.get_base_dir())
	var file := FileAccess.open(METRICS_PATH, FileAccess.WRITE); file.store_string(JSON.stringify(metrics) + "\n"); file.close()
	print("G70_TERRAIN3D_ROAD_PATH_METRICS=" + JSON.stringify(metrics)); print("NE_G70_TERRAIN3D_ROAD_PATH_VALIDATION_OK"); quit(0)
