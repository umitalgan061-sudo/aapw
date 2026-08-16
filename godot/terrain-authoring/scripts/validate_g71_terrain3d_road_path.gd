extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g71-road-path-probe.json"
const METRICS_PATH := "res://.terrain3d-proof/g71-road-path-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g71-road-path-imported-topdown.png"
const EXPECTED_SCHEMA := "westeros-g71-terrain3d-road-path-probe-v1"
const EXPECTED_POLICY := "safak-kartali-g71-terrain3d-road-path-2026-08-16-v1"
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
	push_error("G71 Terrain3D Road/Path proof failed: " + message)
	quit(1)

func _require(ok: bool, message: String) -> bool:
	if not ok:
		_fail(message)
		return false
	return true

func _source_value(probe: Dictionary, channel: int, u: float, v: float) -> float:
	var rows: Array = probe["rows"]
	var gx := clampf(u, 0, 1) * 64.0
	var gy := clampf(v, 0, 1) * 64.0
	var x0 := int(floor(gx))
	var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, 64)
	var y1 := mini(y0 + 1, 64)
	var tx := gx - float(x0)
	var ty := gy - float(y0)
	return lerpf(
		lerpf(float(rows[y0][x0][channel]), float(rows[y0][x1][channel]), tx),
		lerpf(float(rows[y1][x0][channel]), float(rows[y1][x1][channel]), tx),
		ty,
	)

func _height_image(probe: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			image.set_pixel(x, z, Color(_source_value(probe, 0, float(x) / 256.0, float(z) / 256.0), 0, 0, 1))
	return image

func _control_image(probe: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	var base_id := int(probe["baseTextureId"])
	var overlay_id := int(probe["substrateOverlayTextureId"])
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var blend := int(round(clampf(_source_value(probe, 3, float(x) / 256.0, float(z) / 256.0), 0, 1) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(base_id) | Terrain3DUtil.enc_overlay(overlay_id) | Terrain3DUtil.enc_blend(blend)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0, 0, 1))
	return image

func _color_image(probe: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var u := float(x) / 256.0
			var v := float(z) / 256.0
			image.set_pixel(x, z, Color(
				_source_value(probe, 5, u, v),
				_source_value(probe, 6, u, v),
				_source_value(probe, 7, u, v),
				_source_value(probe, 8, u, v),
			))
	return image

func _saved(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null:
		return {"files": [], "bytes": 0}
	var files: Array[String] = []
	var bytes := 0
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			var data := FileAccess.get_file_as_bytes(directory.path_join(name))
			files.push_back(name)
			bytes += data.size()
		name = dir.get_next()
	dir.list_dir_end()
	files.sort()
	return {"files": files, "bytes": bytes}

func _audit_grid(terrain: Terrain3D, probe: Dictionary) -> Dictionary:
	var base_id := int(probe["baseTextureId"])
	var substrate := int(probe["substrateOverlayTextureId"])
	var road_id := int(probe["roadTextureId"])
	var path_id := int(probe["pathTextureId"])
	var max_height := 0.0
	var max_blend := 0.0
	var max_material := 0.0
	var forbidden := 0
	var samples := 0
	var checksum: int = 2166136261
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var u := float(x) / 256.0
			var v := float(z) / 256.0
			var pos := Vector3(float(x), 0, float(z))
			var h := terrain.data.get_height(pos)
			var c := terrain.data.get_color(pos)
			var r := terrain.data.get_roughness(pos)
			var blend := terrain.data.get_control_blend(pos)
			if is_nan(h) or is_nan(c.r) or is_nan(r) or is_nan(blend):
				return {"ok": false}
			var actual_base := terrain.data.get_control_base_id(pos)
			var actual_overlay := terrain.data.get_control_overlay_id(pos)
			if actual_overlay == road_id or actual_overlay == path_id:
				forbidden += 1
			if actual_base != base_id or actual_overlay != substrate:
				return {"ok": false}
			max_height = maxf(max_height, absf(h - _source_value(probe, 0, u, v)))
			max_blend = maxf(max_blend, absf(blend - _source_value(probe, 3, u, v)))
			max_material = maxf(max_material, maxf(
				absf(c.r - _source_value(probe, 5, u, v)),
				maxf(absf(c.g - _source_value(probe, 6, u, v)), maxf(
					absf(c.b - _source_value(probe, 7, u, v)),
					absf(r - _source_value(probe, 8, u, v)),
				)),
			))
			checksum = int((checksum ^ int(round((h + 128.0) * 1000.0)) ^ int(round(clampf(blend, 0, 1) * 255.0))) * 16777619) & 0xffffffff
			samples += 1
	return {"ok": true, "samples": samples, "maxHeightError": max_height, "maxBlendError": max_blend, "maxMaterialError": max_material, "forbidden": forbidden, "checksum": checksum}

func _audit_seam(terrain: Terrain3D, probe: Dictionary) -> Dictionary:
	var axes := [254.75, 255.0, 255.25, 255.5, 255.75, 256.0]
	var cross := [32.25, 96.5, 160.75, 224.5, 256.0]
	var max_height := 0.0
	var max_blend := 0.0
	var max_material := 0.0
	var samples := 0
	for edge in axes:
		for other in cross:
			for raw in [Vector3(float(edge), 0, float(other)), Vector3(float(other), 0, float(edge))]:
				var pos: Vector3 = raw
				var u := pos.x / 256.0
				var v := pos.z / 256.0
				var h := terrain.data.get_height(pos)
				var c := terrain.data.get_color(pos)
				var r := terrain.data.get_roughness(pos)
				var blend := terrain.data.get_control_blend(pos)
				if is_nan(h) or is_nan(c.r) or is_nan(r) or is_nan(blend):
					return {"ok": false}
				max_height = maxf(max_height, absf(h - _source_value(probe, 0, u, v)))
				max_blend = maxf(max_blend, absf(blend - _source_value(probe, 3, u, v)))
				max_material = maxf(max_material, maxf(
					absf(c.r - _source_value(probe, 5, u, v)),
					maxf(absf(c.g - _source_value(probe, 6, u, v)), maxf(
						absf(c.b - _source_value(probe, 7, u, v)),
						absf(r - _source_value(probe, 8, u, v)),
					)),
				))
				samples += 1
	return {"ok": true, "samples": samples, "maxHeightError": max_height, "maxBlendError": max_blend, "maxMaterialError": max_material}

func _write_preview(terrain: Terrain3D) -> Error:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var pos := Vector3(float(x), 0, float(z))
			var c := terrain.data.get_color(pos)
			var r := terrain.data.get_roughness(pos)
			image.set_pixel(x, z, Color(c.r, c.g, c.b, clampf(r, 0, 1)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	return image.save_png(PREVIEW_PATH)

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "probe JSON missing"):
		return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON invalid"):
		return
	var probe: Dictionary = parsed
	if not _require(String(probe.get("schema", "")) == EXPECTED_SCHEMA and String(probe.get("policyId", "")) == EXPECTED_POLICY, "schema/policy drifted"):
		return
	if not _require(String(probe.get("sourceMapSha256", "")) == EXPECTED_MAP_SHA and String(probe.get("geoCell", "")) == "G71" and String(probe.get("layer", "")) == "Road/Path", "provenance drifted"):
		return
	if not _require(int(probe.get("sourceGridSize", 0)) == SOURCE_SIZE and int(probe.get("terrain3dImportSize", 0)) == IMPORT_SIZE and int(probe.get("terrain3dRegionSize", 0)) == REGION_SIZE, "source/import contract drifted"):
		return
	if not _require((probe.get("crossingEdges", []) as Array).size() == 0 and bool(probe.get("eastGuardAllowed", true)) == false and absf(float(probe.get("eastWorldBoundaryX", 0)) - 1.0) <= 0.00000001, "route/world-boundary contract drifted"):
		return
	for row in probe["rows"]:
		if not _require(row is Array and (row as Array).size() == SOURCE_SIZE, "invalid row width"):
			return
		for s in row:
			if not _require(s is Array and (s as Array).size() == 9, "invalid channel count"):
				return
			if not _require(absf(float(s[0]) + 8.0) <= 0.00000001 and absf(float(s[1])) <= BLEND_TOLERANCE and absf(float(s[2])) <= BLEND_TOLERANCE and absf(float(s[3])) <= BLEND_TOLERANCE and int(s[4]) == 0, "source invented road/path or changed Relief"):
				return

	var terrain := Terrain3D.new()
	terrain.name = "G71Terrain3DRoadPathProof"
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"):
		return
	terrain.data.import_images([_height_image(probe), _control_image(probe), _color_image(probe)], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 4, "257x257 import did not create >=4 regions"):
		return
	var grid := _audit_grid(terrain, probe)
	var seam := _audit_seam(terrain, probe)
	if not _require(bool(grid.get("ok", false)) and int(grid.get("samples", 0)) == IMPORT_SIZE * IMPORT_SIZE and int(grid.get("forbidden", -1)) == 0, "native full-grid audit failed"):
		return
	if not _require(float(grid["maxHeightError"]) <= HEIGHT_TOLERANCE and float(grid["maxBlendError"]) <= BLEND_TOLERANCE and float(grid["maxMaterialError"]) <= MATERIAL_TOLERANCE, "native full-grid tolerance failed"):
		return
	if not _require(bool(seam.get("ok", false)) and int(seam.get("samples", 0)) == 60 and float(seam["maxHeightError"]) <= HEIGHT_TOLERANCE and float(seam["maxBlendError"]) <= BLEND_TOLERANCE and float(seam["maxMaterialError"]) <= MATERIAL_TOLERANCE, "255/256 seam failed"):
		return

	var mesh: Mesh = terrain.bake_mesh(0)
	if not _require(mesh != null and mesh.get_surface_count() > 0, "LOD0 bake empty"):
		return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	var suffix := OS.get_environment("G71_ROAD_PATH_PROOF_SUFFIX")
	if suffix.is_empty():
		suffix = "default"
	var save_dir := "user://g71-terrain3d-road-path-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir))
	terrain.data.save_directory(save_dir)
	var saved := _saved(save_dir)
	if not _require(saved["files"].size() >= 4 and int(saved["bytes"]) > 0 and _write_preview(terrain) == OK, "persistence/preview failed"):
		return

	var reload := Terrain3D.new()
	reload.name = "G71Terrain3DRoadPathReload"
	get_root().add_child(reload)
	reload.region_size = REGION_SIZE
	reload.data.load_directory(save_dir)
	if not _require(reload.data.get_region_count() >= 4, "reload region count failed"):
		return
	var reload_grid := _audit_grid(reload, probe)
	var reload_seam := _audit_seam(reload, probe)
	var reload_mesh: Mesh = reload.bake_mesh(0)
	if not _require(bool(reload_grid.get("ok", false)) and int(reload_grid.get("samples", 0)) == IMPORT_SIZE * IMPORT_SIZE and int(reload_grid.get("forbidden", -1)) == 0, "reload full-grid audit failed"):
		return
	if not _require(int(reload_grid["checksum"]) == int(grid["checksum"]) and float(reload_grid["maxHeightError"]) <= HEIGHT_TOLERANCE and float(reload_grid["maxBlendError"]) <= BLEND_TOLERANCE and float(reload_grid["maxMaterialError"]) <= MATERIAL_TOLERANCE, "reload grid parity failed"):
		return
	if not _require(bool(reload_seam.get("ok", false)) and int(reload_seam.get("samples", 0)) == 60 and float(reload_seam["maxHeightError"]) <= HEIGHT_TOLERANCE and float(reload_seam["maxBlendError"]) <= BLEND_TOLERANCE and float(reload_seam["maxMaterialError"]) <= MATERIAL_TOLERANCE, "reload seam failed"):
		return
	if not _require(reload_mesh != null and reload_mesh.get_surface_count() > 0, "reload LOD0 bake empty"):
		return
	var reload_vertices: PackedVector3Array = reload_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]

	var metrics := {
		"terrain3dVersion": String(terrain.version), "regionSize": int(terrain.region_size), "regionCount": terrain.data.get_region_count(),
		"gridSamples": int(grid["samples"]), "seamSamples": int(seam["samples"]), "forbiddenRoadPathOverlaySamples": int(grid["forbidden"]),
		"maxHeightError": snappedf(float(grid["maxHeightError"]), 0.00000001), "maxActualBlend": snappedf(float(grid["maxBlendError"]), 0.00000001), "maxMaterialError": snappedf(float(grid["maxMaterialError"]), 0.00000001),
		"maxSeamHeightError": snappedf(float(seam["maxHeightError"]), 0.00000001), "maxSeamBlend": snappedf(float(seam["maxBlendError"]), 0.00000001), "maxSeamMaterialError": snappedf(float(seam["maxMaterialError"]), 0.00000001),
		"outputChecksum": int(grid["checksum"]), "bakedSurfaces": mesh.get_surface_count(), "bakedVertices": vertices.size(),
		"savedRegionFiles": saved["files"].size(), "savedRegionBytes": int(saved["bytes"]),
		"reloadRegionCount": reload.data.get_region_count(), "reloadGridSamples": int(reload_grid["samples"]), "reloadChecksum": int(reload_grid["checksum"]), "reloadBakedVertices": reload_vertices.size(),
	}
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	var file := FileAccess.open(METRICS_PATH, FileAccess.WRITE)
	if not _require(file != null, "metrics write failed"):
		return
	file.store_string(JSON.stringify(metrics) + "\n")
	file.close()
	print("G71_TERRAIN3D_ROAD_PATH_METRICS=" + JSON.stringify(metrics))
	print("NE_G71_TERRAIN3D_ROAD_PATH_VALIDATION_OK")
	quit(0)
