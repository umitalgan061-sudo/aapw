extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g71-near-detail-probe.json"
const METRICS_PATH := "res://.terrain3d-proof/g71-near-detail-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g71-near-detail-imported-topdown.png"
const EXPECTED_SCHEMA := "westeros-g71-terrain3d-near-detail-probe-v1"
const EXPECTED_POLICY := "safak-kartali-g71-terrain3d-near-detail-2026-08-16-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 129
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const HEIGHT_TOLERANCE := 0.001
const BLEND_TOLERANCE := 0.000001
const MATERIAL_TOLERANCE := 0.006

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G71 Terrain3D Near Detail proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _source_value(probe: Dictionary, channel: int, u: float, v: float) -> float:
	var rows: Array = probe["rows"]
	var gx: float = clampf(u, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var gy: float = clampf(v, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var x0 := int(floor(gx))
	var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, SOURCE_SIZE - 1)
	var y1 := mini(y0 + 1, SOURCE_SIZE - 1)
	var tx: float = gx - float(x0)
	var ty: float = gy - float(y0)
	var a := float(rows[y0][x0][channel])
	var b := float(rows[y0][x1][channel])
	var c := float(rows[y1][x0][channel])
	var d := float(rows[y1][x1][channel])
	return lerpf(lerpf(a, b, tx), lerpf(c, d, tx), ty)

func _source_color(probe: Dictionary, u: float, v: float) -> Color:
	return Color(
		clampf(_source_value(probe, 2, u, v), 0.0, 1.0),
		clampf(_source_value(probe, 3, u, v), 0.0, 1.0),
		clampf(_source_value(probe, 4, u, v), 0.0, 1.0),
		clampf(_source_value(probe, 5, u, v), 0.0, 1.0)
	)

func _height_image(probe: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var u := float(x) / 256.0
			var v := float(z) / 256.0
			image.set_pixel(x, z, Color(_source_value(probe, 0, u, v), 0.0, 0.0, 1.0))
	return image

func _control_image(probe: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	var base_id := int(probe["baseTextureId"])
	var overlay_id := int(probe["overlayTextureId"])
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var u := float(x) / 256.0
			var v := float(z) / 256.0
			var blend := int(round(clampf(_source_value(probe, 1, u, v), 0.0, 1.0) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(base_id) | Terrain3DUtil.enc_overlay(overlay_id) | Terrain3DUtil.enc_blend(blend)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0.0, 0.0, 1.0))
	return image

func _color_image(probe: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			image.set_pixel(x, z, _source_color(probe, float(x) / 256.0, float(z) / 256.0))
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
			if data.size() > 0:
				files.push_back(name)
				bytes += data.size()
		name = dir.get_next()
	dir.list_dir_end()
	files.sort()
	return {"files": files, "bytes": bytes}

func _audit_grid(terrain: Terrain3D, probe: Dictionary) -> Dictionary:
	var max_height := 0.0
	var max_blend := 0.0
	var max_color := 0.0
	var max_rough := 0.0
	var forbidden_overlay_samples := 0
	var checksum: int = 2166136261
	var samples := 0
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var u := float(x) / 256.0
			var v := float(z) / 256.0
			var pos := Vector3(float(x), 0.0, float(z))
			var height := terrain.data.get_height(pos)
			var blend := terrain.data.get_control_blend(pos)
			var color := terrain.data.get_color(pos)
			var rough := terrain.data.get_roughness(pos)
			if is_nan(height) or is_nan(blend) or is_nan(color.r) or is_nan(rough):
				return {"ok": false}
			var base_id := terrain.data.get_control_base_id(pos)
			var overlay_id := terrain.data.get_control_overlay_id(pos)
			if base_id != int(probe["baseTextureId"]) or overlay_id != int(probe["overlayTextureId"]):
				forbidden_overlay_samples += 1
			var expected := _source_color(probe, u, v)
			max_height = maxf(max_height, absf(height - _source_value(probe, 0, u, v)))
			max_blend = maxf(max_blend, absf(blend - _source_value(probe, 1, u, v)))
			max_color = maxf(max_color, maxf(absf(color.r - expected.r), maxf(absf(color.g - expected.g), absf(color.b - expected.b))))
			max_rough = maxf(max_rough, absf(rough - expected.a))
			checksum = int((checksum ^ int(round((height + 128.0) * 1000.0)) ^ int(round(clampf(blend, 0.0, 1.0) * 255.0)) ^ int(round(clampf(rough, 0.0, 1.0) * 255.0))) * 16777619) & 0xffffffff
			samples += 1
	return {"ok": true, "samples": samples, "maxHeightError": max_height, "maxBlendError": max_blend, "maxColorError": max_color, "maxRoughnessError": max_rough, "forbiddenOverlaySamples": forbidden_overlay_samples, "checksum": checksum}

func _audit_seam(terrain: Terrain3D, probe: Dictionary) -> Dictionary:
	var seam_axis := [254.75, 255.0, 255.25, 255.5, 255.75, 256.0]
	var cross_axis := [32.25, 96.5, 160.75, 224.5, 256.0]
	var max_height := 0.0
	var max_material := 0.0
	var samples := 0
	for edge in seam_axis:
		for cross in cross_axis:
			for raw_pos in [Vector3(float(edge), 0.0, float(cross)), Vector3(float(cross), 0.0, float(edge))]:
				var pos: Vector3 = raw_pos
				var u: float = pos.x / 256.0
				var v: float = pos.z / 256.0
				var expected := _source_color(probe, u, v)
				var color := terrain.data.get_color(pos)
				max_height = maxf(max_height, absf(terrain.data.get_height(pos) - _source_value(probe, 0, u, v)))
				max_material = maxf(max_material, absf(terrain.data.get_control_blend(pos) - _source_value(probe, 1, u, v)))
				max_material = maxf(max_material, absf(color.r - expected.r))
				max_material = maxf(max_material, absf(color.g - expected.g))
				max_material = maxf(max_material, absf(color.b - expected.b))
				max_material = maxf(max_material, absf(terrain.data.get_roughness(pos) - expected.a))
				samples += 1
	return {"samples": samples, "maxHeightError": max_height, "maxMaterialError": max_material}

func _write_preview(terrain: Terrain3D) -> Error:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var pos := Vector3(float(x), 0.0, float(z))
			var c := terrain.data.get_color(pos)
			image.set_pixel(x, z, Color(c.r, c.g, c.b, clampf(terrain.data.get_roughness(pos), 0.0, 1.0)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	return image.save_png(PREVIEW_PATH)

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "probe missing"):
		return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe invalid"):
		return
	var probe: Dictionary = parsed
	if not _require(String(probe.get("schema", "")) == EXPECTED_SCHEMA, "schema drifted"):
		return
	if not _require(String(probe.get("policyId", "")) == EXPECTED_POLICY, "policy drifted"):
		return
	if not _require(String(probe.get("sourceMapSha256", "")) == EXPECTED_MAP_SHA, "map provenance drifted"):
		return
	if not _require(String(probe.get("geoCell", "")) == "G71" and String(probe.get("layer", "")) == "Near Detail", "cell/layer drifted"):
		return
	if not _require(int(probe.get("sourceGridSize", 0)) == SOURCE_SIZE and int(probe.get("terrain3dImportSize", 0)) == IMPORT_SIZE and int(probe.get("terrain3dRegionSize", 0)) == REGION_SIZE, "dimensions drifted"):
		return
	if not _require(int(probe.get("canonicalWaterCells", 0)) == 96 and int(probe.get("canonicalLandCells", 1)) == 0, "G71 must remain open sea"):
		return
	if not _require(float(probe.get("maxHeightDelta", 1)) == 0.0 and float(probe.get("maxControlDelta", 1)) == 0.0 and float(probe.get("maxRoadPathDelta", 1)) == 0.0 and float(probe.get("maxFoliageDensity", 1)) == 0.0, "Near Detail changed prior layers"):
		return

	var terrain := Terrain3D.new()
	terrain.name = "G71Terrain3DNearDetailProof"
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"):
		return
	terrain.data.import_images([_height_image(probe), _control_image(probe), _color_image(probe)], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 4, "257 import did not create >=4 regions"):
		return
	var grid := _audit_grid(terrain, probe)
	if not _require(bool(grid.get("ok", false)) and int(grid.get("samples", 0)) == 66049 and int(grid.get("forbiddenOverlaySamples", 1)) == 0, "native full-grid audit failed"):
		return
	if not _require(float(grid["maxHeightError"]) <= HEIGHT_TOLERANCE and float(grid["maxBlendError"]) <= BLEND_TOLERANCE and float(grid["maxColorError"]) <= MATERIAL_TOLERANCE and float(grid["maxRoughnessError"]) <= MATERIAL_TOLERANCE, "native roundtrip exceeded tolerance"):
		return
	var seam := _audit_seam(terrain, probe)
	if not _require(int(seam.get("samples", 0)) == 60 and float(seam["maxHeightError"]) <= HEIGHT_TOLERANCE and float(seam["maxMaterialError"]) <= MATERIAL_TOLERANCE, "255/256 seam failed"):
		return
	var mesh: Mesh = terrain.bake_mesh(0)
	if not _require(mesh != null and mesh.get_surface_count() > 0, "LOD0 bake empty"):
		return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "LOD0 vertices empty"):
		return
	var suffix := OS.get_environment("G71_NEAR_DETAIL_PROOF_SUFFIX")
	if suffix.is_empty():
		suffix = "default"
	var out_dir := "user://g71-terrain3d-near-detail-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(out_dir))
	terrain.data.save_directory(out_dir)
	var saved := _saved(out_dir)
	if not _require(saved["files"].size() >= 4 and int(saved["bytes"]) > 0, "persistence failed"):
		return
	if not _require(_write_preview(terrain) == OK, "preview failed"):
		return

	var reload := Terrain3D.new()
	reload.name = "G71Terrain3DNearDetailReload"
	get_root().add_child(reload)
	reload.region_size = REGION_SIZE
	reload.data.load_directory(out_dir)
	if not _require(reload.data.get_region_count() >= 4, "reload region count failed"):
		return
	var reload_grid := _audit_grid(reload, probe)
	var reload_seam := _audit_seam(reload, probe)
	if not _require(bool(reload_grid.get("ok", false)) and int(reload_grid.get("samples", 0)) == 66049 and int(reload_grid.get("forbiddenOverlaySamples", 1)) == 0, "reload full-grid failed"):
		return
	if not _require(float(reload_grid["maxHeightError"]) <= HEIGHT_TOLERANCE and float(reload_grid["maxBlendError"]) <= BLEND_TOLERANCE and float(reload_grid["maxColorError"]) <= MATERIAL_TOLERANCE and float(reload_grid["maxRoughnessError"]) <= MATERIAL_TOLERANCE, "reload roundtrip exceeded tolerance"):
		return
	if not _require(int(reload_seam.get("samples", 0)) == 60 and float(reload_seam["maxHeightError"]) <= HEIGHT_TOLERANCE and float(reload_seam["maxMaterialError"]) <= MATERIAL_TOLERANCE, "reload seam failed"):
		return
	var reload_mesh: Mesh = reload.bake_mesh(0)
	if not _require(reload_mesh != null and reload_mesh.get_surface_count() > 0, "reload LOD0 empty"):
		return
	var reload_vertices: PackedVector3Array = reload_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(reload_vertices.size() == vertices.size(), "reload LOD0 vertex count drifted"):
		return
	if not _require(int(reload_grid["checksum"]) == int(grid["checksum"]), "reload semantic checksum drifted"):
		return

	var metrics := {
		"terrain3dVersion": String(terrain.version), "regionCount": terrain.data.get_region_count(),
		"fullGridSamples": int(grid["samples"]), "forbiddenOverlaySamples": int(grid["forbiddenOverlaySamples"]),
		"maxHeightError": float(grid["maxHeightError"]), "maxBlendError": float(grid["maxBlendError"]),
		"maxColorError": float(grid["maxColorError"]), "maxRoughnessError": float(grid["maxRoughnessError"]),
		"seamSamples": int(seam["samples"]), "maxSeamHeightError": float(seam["maxHeightError"]), "maxSeamMaterialError": float(seam["maxMaterialError"]),
		"bakedVertices": vertices.size(), "savedRegionFiles": saved["files"].size(), "savedRegionBytes": int(saved["bytes"]), "checksum": int(grid["checksum"]),
		"reloadRegionCount": reload.data.get_region_count(), "reloadGridSamples": int(reload_grid["samples"]), "reloadChecksum": int(reload_grid["checksum"]), "reloadBakedVertices": reload_vertices.size()
	}
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	var file := FileAccess.open(METRICS_PATH, FileAccess.WRITE)
	if not _require(file != null, "metrics write failed"):
		return
	file.store_string(JSON.stringify(metrics) + "\n")
	file.close()
	print("G71_TERRAIN3D_NEAR_DETAIL_METRICS=" + JSON.stringify(metrics))
	print("NE_G71_TERRAIN3D_NEAR_DETAIL_VALIDATION_OK")
	quit(0)
