extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g71-rock-snow-probe.json"
const METRICS_PATH := "res://.terrain3d-proof/g71-rock-snow-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g71-rock-snow-imported-topdown.png"
const EXPECTED_SCHEMA := "westeros-g71-terrain3d-rock-snow-probe-v1"
const EXPECTED_POLICY := "safak-kartali-g71-terrain3d-rock-snow-2026-08-15-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const HEIGHT_TOLERANCE := 0.001
const MATERIAL_TOLERANCE := 0.006
const BLEND_TOLERANCE := 0.000001

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G71 Terrain3D Rock/Snow proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _source_value(probe: Dictionary, channel: int, u: float, v: float) -> float:
	var rows: Array = probe["rows"]
	var gx := clampf(u, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var gy := clampf(v, 0.0, 1.0) * float(SOURCE_SIZE - 1)
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
			image.set_pixel(x, z, Color(_source_value(probe, 3, float(x) / 256.0, float(z) / 256.0), 0, 0, 1))
	return image

func _control_image(probe: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	var base_id := int(probe["baseTextureId"])
	var overlay_id := int(probe["overlayTextureId"])
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var blend := int(round(clampf(_source_value(probe, 4, float(x) / 256.0, float(z) / 256.0), 0, 1) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(base_id) | Terrain3DUtil.enc_overlay(overlay_id) | Terrain3DUtil.enc_blend(blend)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0, 0, 1))
	return image

func _color_image(probe: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var u := float(x) / 256.0; var v := float(z) / 256.0
			image.set_pixel(x, z, Color(
				_source_value(probe, 5, u, v), _source_value(probe, 6, u, v),
				_source_value(probe, 7, u, v), _source_value(probe, 8, u, v)))
	return image

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null: return {"files": [], "totalBytes": 0}
	var files: Array[String] = []; var total_bytes := 0
	dir.list_dir_begin(); var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			var bytes := FileAccess.get_file_as_bytes(directory.path_join(name))
			if bytes.size() > 0:
				files.push_back(name); total_bytes += bytes.size()
		name = dir.get_next()
	dir.list_dir_end(); files.sort()
	return {"files": files, "totalBytes": total_bytes}

func _write_preview(terrain: Terrain3D) -> Error:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var pos := Vector3(float(x), 0, float(z))
			var color := terrain.data.get_color(pos)
			var roughness := terrain.data.get_roughness(pos)
			var blend := terrain.data.get_control_blend(pos)
			if is_nan(color.r) or is_nan(color.g) or is_nan(color.b) or is_nan(roughness) or is_nan(blend): return ERR_INVALID_DATA
			# Zero terrestrial overlay keeps the proof oceanic; alpha stores roughness.
			image.set_pixel(x, z, Color(color.r, color.g, color.b, clampf(roughness, 0, 1)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	return image.save_png(PREVIEW_PATH)

func _audit_grid(terrain: Terrain3D, probe: Dictionary) -> Dictionary:
	var base_id := int(probe["baseTextureId"]); var overlay_id := int(probe["overlayTextureId"])
	var max_height_error := 0.0; var max_blend := 0.0; var max_material_error := 0.0
	var checksum: int = 2166136261; var samples := 0
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var u := float(x) / 256.0; var v := float(z) / 256.0; var pos := Vector3(float(x), 0, float(z))
			var height := terrain.data.get_height(pos); var color := terrain.data.get_color(pos)
			var roughness := terrain.data.get_roughness(pos); var blend := terrain.data.get_control_blend(pos)
			if is_nan(height) or is_nan(color.r) or is_nan(roughness) or is_nan(blend): return {"ok": false}
			if terrain.data.get_control_base_id(pos) != base_id or terrain.data.get_control_overlay_id(pos) != overlay_id: return {"ok": false}
			max_height_error = maxf(max_height_error, absf(height - _source_value(probe, 3, u, v)))
			max_blend = maxf(max_blend, absf(blend))
			max_material_error = maxf(max_material_error, maxf(
				absf(color.r - _source_value(probe, 5, u, v)), maxf(
				absf(color.g - _source_value(probe, 6, u, v)), maxf(
				absf(color.b - _source_value(probe, 7, u, v)), absf(roughness - _source_value(probe, 8, u, v))))))
			checksum = int((checksum ^ int(round((height + 128.0) * 1000.0)) ^ int(round(clampf(blend, 0, 1) * 255.0))) * 16777619) & 0xffffffff
			samples += 1
	return {"ok": true, "samples": samples, "maxHeightError": max_height_error, "maxBlend": max_blend, "maxMaterialError": max_material_error, "checksum": checksum}

func _audit_seam(terrain: Terrain3D, probe: Dictionary) -> Dictionary:
	var axes := [254.75, 255.0, 255.25, 255.5, 255.75, 256.0]
	var cross := [32.25, 96.5, 160.75, 224.5, 256.0]
	var max_height_error := 0.0; var max_blend := 0.0; var max_material_error := 0.0; var samples := 0
	for edge in axes:
		for other in cross:
			for raw_pos in [Vector3(float(edge), 0, float(other)), Vector3(float(other), 0, float(edge))]:
				var pos: Vector3 = raw_pos; var u := pos.x / 256.0; var v := pos.z / 256.0
				var height := terrain.data.get_height(pos); var color := terrain.data.get_color(pos)
				var roughness := terrain.data.get_roughness(pos); var blend := terrain.data.get_control_blend(pos)
				if is_nan(height) or is_nan(color.r) or is_nan(roughness) or is_nan(blend): return {"ok": false}
				max_height_error = maxf(max_height_error, absf(height - _source_value(probe, 3, u, v)))
				max_blend = maxf(max_blend, absf(blend))
				max_material_error = maxf(max_material_error, maxf(
					absf(color.r - _source_value(probe, 5, u, v)), maxf(
					absf(color.g - _source_value(probe, 6, u, v)), maxf(
					absf(color.b - _source_value(probe, 7, u, v)), absf(roughness - _source_value(probe, 8, u, v))))))
				samples += 1
	return {"ok": true, "samples": samples, "maxHeightError": max_height_error, "maxBlend": max_blend, "maxMaterialError": max_material_error}

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON invalid"): return
	var probe: Dictionary = parsed
	if not _require(String(probe.get("schema", "")) == EXPECTED_SCHEMA, "schema drifted"): return
	if not _require(String(probe.get("policyId", "")) == EXPECTED_POLICY, "policy drifted"): return
	if not _require(String(probe.get("sourceMapSha256", "")) == EXPECTED_MAP_SHA, "map.png provenance drifted"): return
	if not _require(String(probe.get("geoCell", "")) == "G71", "GeoCell drifted"): return
	if not _require(int(probe.get("sourceGridSize", 0)) == SOURCE_SIZE, "source must remain 65x65"): return
	if not _require(int(probe.get("terrain3dImportSize", 0)) == IMPORT_SIZE and int(probe.get("terrain3dRegionSize", 0)) == REGION_SIZE, "expected 257 import over region 256"): return
	if not _require(bool(probe.get("eastGuardAllowed", true)) == false and absf(float(probe.get("eastWorldBoundaryX", 0.0)) - 1.0) <= 0.00000001, "east world-boundary contract drifted"): return
	for row in probe["rows"]:
		if not _require(row is Array and (row as Array).size() == SOURCE_SIZE, "invalid probe row width"): return
		for sample in row:
			if not _require(sample is Array and (sample as Array).size() == 9, "invalid probe channel count"): return
			if not _require(absf(float(sample[0])) <= 0.00000001 and absf(float(sample[1])) <= 0.00000001, "source invented rock/snow over sea"): return
			if not _require(absf(float(sample[2])) <= 0.00000001 and absf(float(sample[4])) <= 0.00000001, "source invented terrestrial control"): return
			if not _require(absf(float(sample[3]) + 8.0) <= 0.00000001, "source changed qualified Relief height"): return

	var terrain := Terrain3D.new(); terrain.name = "G71Terrain3DRockSnowProof"; get_root().add_child(terrain); terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	terrain.data.import_images([_height_image(probe), _control_image(probe), _color_image(probe)], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 4, "257x257 Height+Control+Color import did not create >=4 regions"): return

	var grid := _audit_grid(terrain, probe)
	if not _require(bool(grid.get("ok", false)) and int(grid.get("samples", 0)) == IMPORT_SIZE * IMPORT_SIZE, "full native grid audit failed"): return
	if not _require(float(grid["maxHeightError"]) <= HEIGHT_TOLERANCE and float(grid["maxBlend"]) <= BLEND_TOLERANCE and float(grid["maxMaterialError"]) <= MATERIAL_TOLERANCE, "native grid exceeded terrain/material tolerance"): return
	var seam := _audit_seam(terrain, probe)
	if not _require(bool(seam.get("ok", false)) and int(seam.get("samples", 0)) == 60, "255/256 seam audit failed"): return
	if not _require(float(seam["maxHeightError"]) <= HEIGHT_TOLERANCE and float(seam["maxBlend"]) <= BLEND_TOLERANCE and float(seam["maxMaterialError"]) <= MATERIAL_TOLERANCE, "255/256 seam exceeded tolerance"): return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "LOD0 bake returned no surface"): return
	var vertices: PackedVector3Array = baked_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "LOD0 bake returned no vertices"): return
	var suffix := OS.get_environment("G71_ROCK_SNOW_PROOF_SUFFIX"); if suffix.is_empty(): suffix = "default"
	var save_dir := "user://g71-terrain3d-rock-snow-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir)); terrain.data.save_directory(save_dir)
	var saved := _saved_region_evidence(save_dir)
	if not _require(saved["files"].size() >= 4 and int(saved["totalBytes"]) > 0, "Terrain3D region persistence failed"): return
	if not _require(_write_preview(terrain) == OK, "failed to write imported top-down proof"): return

	var reload := Terrain3D.new(); reload.name = "G71Terrain3DRockSnowReload"; get_root().add_child(reload); reload.region_size = REGION_SIZE
	reload.data.load_directory(save_dir)
	if not _require(reload.data.get_region_count() >= 4, "reloaded Terrain3D region count regressed"): return
	var reload_grid := _audit_grid(reload, probe); var reload_seam := _audit_seam(reload, probe)
	if not _require(bool(reload_grid.get("ok", false)) and int(reload_grid.get("samples", 0)) == IMPORT_SIZE * IMPORT_SIZE, "reload full-grid audit failed"): return
	if not _require(float(reload_grid["maxHeightError"]) <= HEIGHT_TOLERANCE and float(reload_grid["maxBlend"]) <= BLEND_TOLERANCE and float(reload_grid["maxMaterialError"]) <= MATERIAL_TOLERANCE, "reload grid exceeded tolerance"): return
	if not _require(bool(reload_seam.get("ok", false)) and float(reload_seam["maxHeightError"]) <= HEIGHT_TOLERANCE and float(reload_seam["maxBlend"]) <= BLEND_TOLERANCE and float(reload_seam["maxMaterialError"]) <= MATERIAL_TOLERANCE, "reload seam exceeded tolerance"): return
	var reload_mesh: Mesh = reload.bake_mesh(0)
	if not _require(reload_mesh != null and reload_mesh.get_surface_count() > 0, "reload LOD0 bake returned no surface"): return
	var reload_vertices: PackedVector3Array = reload_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(reload_vertices.size() > 0, "reload LOD0 vertices empty"): return

	var metrics := {
		"terrain3dVersion": String(terrain.version), "regionSize": int(terrain.region_size), "regionCount": terrain.data.get_region_count(),
		"fullGridSamples": int(grid["samples"]), "maxHeightError": snappedf(float(grid["maxHeightError"]), 0.00000001),
		"maxActualBlend": snappedf(float(grid["maxBlend"]), 0.00000001), "maxMaterialError": snappedf(float(grid["maxMaterialError"]), 0.00000001), "outputChecksum": int(grid["checksum"]),
		"seamSamples": int(seam["samples"]), "maxSeamHeightError": snappedf(float(seam["maxHeightError"]), 0.00000001),
		"maxSeamBlend": snappedf(float(seam["maxBlend"]), 0.00000001), "maxSeamMaterialError": snappedf(float(seam["maxMaterialError"]), 0.00000001),
		"bakedSurfaces": baked_mesh.get_surface_count(), "bakedVertices": vertices.size(), "savedRegionFiles": saved["files"].size(), "savedRegionBytes": int(saved["totalBytes"]),
		"reloadRegionCount": reload.data.get_region_count(), "reloadGridSamples": int(reload_grid["samples"]),
		"reloadMaxHeightError": snappedf(float(reload_grid["maxHeightError"]), 0.00000001), "reloadMaxBlend": snappedf(float(reload_grid["maxBlend"]), 0.00000001),
		"reloadMaxMaterialError": snappedf(float(reload_grid["maxMaterialError"]), 0.00000001), "reloadChecksum": int(reload_grid["checksum"]),
		"reloadMaxSeamHeightError": snappedf(float(reload_seam["maxHeightError"]), 0.00000001), "reloadMaxSeamBlend": snappedf(float(reload_seam["maxBlend"]), 0.00000001),
		"reloadMaxSeamMaterialError": snappedf(float(reload_seam["maxMaterialError"]), 0.00000001), "reloadBakedVertices": reload_vertices.size(),
	}
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	var file := FileAccess.open(METRICS_PATH, FileAccess.WRITE)
	if not _require(file != null, "could not write metrics"): return
	file.store_string(JSON.stringify(metrics) + "\n"); file.close()
	print("G71_TERRAIN3D_ROCK_SNOW_METRICS=" + JSON.stringify(metrics))
	print("NE_G71_TERRAIN3D_ROCK_SNOW_VALIDATION_OK")
	quit(0)
