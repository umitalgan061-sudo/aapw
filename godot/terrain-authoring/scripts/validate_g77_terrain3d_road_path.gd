extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g77-road-path-probe.json"
const METRICS_PATH := "res://.terrain3d-proof/g77-road-path-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g77-road-path-imported-topdown.png"
const EXPECTED_SCHEMA := "westeros-g77-terrain3d-road-path-probe-v1"
const EXPECTED_POLICY := "kizil-ufuk-g77-terrain3d-road-path-2026-08-16-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const MAX_HEIGHT_ERROR := 0.00002
const MAX_BLEND_ERROR := 0.006

func _initialize() -> void: call_deferred("_run")
func _fail(message: String) -> void: push_error("G77 Terrain3D Road/Path proof failed: " + message); quit(1)
func _need(ok: bool, message: String) -> bool:
	if not ok: _fail(message); return false
	return true

func _value(probe: Dictionary, channel: int, u: float, v: float) -> float:
	var rows: Array = probe["rows"]
	var gx := clampf(u, 0, 1) * 256.0; var gy := clampf(v, 0, 1) * 256.0
	var x0 := int(floor(gx)); var y0 := int(floor(gy)); var x1 := mini(x0 + 1, 256); var y1 := mini(y0 + 1, 256)
	var tx := gx - float(x0); var ty := gy - float(y0)
	return lerpf(lerpf(float(rows[y0][x0][channel]), float(rows[y0][x1][channel]), tx), lerpf(float(rows[y1][x0][channel]), float(rows[y1][x1][channel]), tx), ty)

func _control(probe: Dictionary, u: float, v: float) -> Dictionary:
	var road := clampf(_value(probe, 1, u, v), 0, 1); var path := clampf(_value(probe, 2, u, v), 0, 1); var coverage := maxf(road, path)
	if coverage > 0.002:
		var ground := clampf(_value(probe, 4, u, v), 0, 1); var route_rock := clampf(_value(probe, 5, u, v), 0, 1); var route_snow := clampf(_value(probe, 6, u, v), 0, 1)
		var base := int(probe["groundTextureId"]); var best := ground
		if route_rock > best: base = int(probe["rockTextureId"]); best = route_rock
		if route_snow > best: base = int(probe["snowTextureId"])
		return {"base": base, "overlay": int(probe["pathTextureId"]) if path > road else int(probe["roadTextureId"]), "blend": coverage, "route": true}
	var substrate_rock := clampf(_value(probe, 5, u, v), 0, 1); var substrate_snow := clampf(_value(probe, 6, u, v), 0, 1)
	return {"base": int(probe["groundTextureId"]), "overlay": int(probe["snowTextureId"]) if substrate_snow > substrate_rock else int(probe["rockTextureId"]), "blend": maxf(substrate_rock, substrate_snow), "route": false}

func _images(probe: Dictionary) -> Array:
	var height := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	var control := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var u := float(x) / 256.0; var v := float(z) / 256.0; var expected := _control(probe, u, v)
			height.set_pixel(x, z, Color(_value(probe, 0, u, v), 0, 0, 1))
			var bits: int = Terrain3DUtil.enc_base(int(expected["base"])) | Terrain3DUtil.enc_overlay(int(expected["overlay"])) | Terrain3DUtil.enc_blend(int(round(clampf(float(expected["blend"]), 0, 1) * 255.0)))
			control.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0, 0, 1))
	return [height, control, null]

func _audit(terrain: Terrain3D, probe: Dictionary) -> Dictionary:
	var max_h := 0.0; var max_b := 0.0; var samples := 0; var route_samples := 0; var seam_samples := 0; var checksum: int = 2166136261
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var u := float(x) / 256.0; var v := float(z) / 256.0; var expected := _control(probe, u, v); var pos := Vector3(float(x), 0, float(z))
			var h := terrain.data.get_height(pos); var blend := terrain.data.get_control_blend(pos)
			if is_nan(h) or is_nan(blend): return {"ok": false}
			var actual_base := terrain.data.get_control_base_id(pos); var actual_overlay := terrain.data.get_control_overlay_id(pos)
			if actual_base != int(expected["base"]): return {"ok": false}
			if int(round(float(expected["blend"]) * 255.0)) > 0 and actual_overlay != int(expected["overlay"]): return {"ok": false}
			var he := absf(h - _value(probe, 0, u, v)); var be := absf(blend - float(expected["blend"]))
			max_h = maxf(max_h, he); max_b = maxf(max_b, be)
			if bool(expected["route"]) and blend > 0.02: route_samples += 1
			if x >= 255 or z >= 255: seam_samples += 1
			checksum = int((checksum ^ int(round((h + 256.0) * 1000.0)) ^ int(round(clampf(blend, 0, 1) * 255.0)) ^ actual_base ^ (actual_overlay << 4)) * 16777619) & 0xffffffff
			samples += 1
	return {"ok": true, "samples": samples, "routeSamples": route_samples, "seamSamples": seam_samples, "maxHeightError": max_h, "maxBlendError": max_b, "checksum": checksum}

func _saved(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null: return {"files": 0, "bytes": 0}
	var files := 0; var bytes := 0
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			var payload := FileAccess.get_file_as_bytes(directory.path_join(name))
			if payload.size() > 0:
				files += 1
				bytes += payload.size()
		name = dir.get_next()
	dir.list_dir_end()
	return {"files": files, "bytes": bytes}

func _color_for(id: int) -> Color:
	match id:
		0: return Color(0.36, 0.30, 0.22, 1)
		1: return Color(0.34, 0.34, 0.33, 1)
		2: return Color(0.90, 0.92, 0.94, 1)
		3: return Color(0.46, 0.34, 0.20, 1)
		4: return Color(0.38, 0.29, 0.18, 1)
		_: return Color(0.5, 0.5, 0.5, 1)

func _preview(terrain: Terrain3D) -> bool:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var pos := Vector3(float(x), 0, float(z)); var base := terrain.data.get_control_base_id(pos); var overlay := terrain.data.get_control_overlay_id(pos); var blend := terrain.data.get_control_blend(pos)
			if is_nan(blend): return false
			image.set_pixel(x, z, _color_for(base).lerp(_color_for(overlay), clampf(blend, 0, 1)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(PREVIEW_PATH).get_base_dir()); return image.save_png(PREVIEW_PATH) == OK

func _write_metrics(metrics: Dictionary) -> bool:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(METRICS_PATH).get_base_dir())
	var file := FileAccess.open(METRICS_PATH, FileAccess.WRITE)
	if file == null: return false
	file.store_string(JSON.stringify(metrics)); file.close(); return true

func _run() -> void:
	if not _need(FileAccess.file_exists(PROBE_PATH), "probe missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH)); if not _need(parsed is Dictionary, "probe invalid"): return
	var probe: Dictionary = parsed
	if not _need(String(probe.get("schema", "")) == EXPECTED_SCHEMA and String(probe.get("policyId", "")) == EXPECTED_POLICY, "schema/policy drifted"): return
	if not _need(String(probe.get("sourceMapSha256", "")) == EXPECTED_MAP_SHA and String(probe.get("geoCell", "")) == "G77" and String(probe.get("layer", "")) == "Road/Path", "provenance drifted"): return
	if not _need(int(probe.get("sourceGridSize", 0)) == IMPORT_SIZE and int(probe.get("terrain3dImportSize", 0)) == IMPORT_SIZE and int(probe.get("terrain3dRegionSize", 0)) == REGION_SIZE, "size contract drifted"): return
	if not _need(int(probe.get("canonicalWaterCells", 0)) == 44 and int(probe.get("canonicalLandCells", 0)) == 52, "G77 44/52 fingerprint drifted"): return
	var terrain := Terrain3D.new(); terrain.name = "G77Terrain3DRoadPath"; get_root().add_child(terrain); terrain.region_size = REGION_SIZE
	if not _need(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D 1.0.2 not loaded"): return
	terrain.data.import_images(_images(probe), Vector3.ZERO, 0, 1)
	if not _need(terrain.data.get_region_count() >= 4, "257 import did not create >=4 regions"): return
	var audit := _audit(terrain, probe)
	if not _need(bool(audit.get("ok", false)) and int(audit.get("samples", 0)) == 66049, "full-grid audit failed"): return
	if not _need(float(audit["maxHeightError"]) <= MAX_HEIGHT_ERROR and float(audit["maxBlendError"]) <= MAX_BLEND_ERROR, "native tolerance failed"): return
	var expected_active := int(probe.get("activeRoadSamples", 0)) + int(probe.get("activePathSamples", 0))
	if not _need((expected_active > 0) == (int(audit["routeSamples"]) > 0), "live route vanished or was invented in Terrain3D"): return
	var mesh: Mesh = terrain.bake_mesh(0); if not _need(mesh != null and mesh.get_surface_count() > 0, "LOD0 bake empty"): return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]; if not _need(vertices.size() > 0, "LOD0 vertices empty"): return
	var suffix := OS.get_environment("G77_ROAD_PATH_PROOF_SUFFIX"); if suffix.is_empty(): suffix = "default"
	var save_dir := "user://g77-terrain3d-road-path-" + suffix; DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir)); terrain.data.save_directory(save_dir)
	var saved := _saved(save_dir); if not _need(int(saved["files"]) >= 4 and int(saved["bytes"]) > 0, "persisted regions missing"): return
	var reload := Terrain3D.new(); reload.name = "G77Terrain3DRoadPathReload"; get_root().add_child(reload); reload.region_size = REGION_SIZE; reload.data.load_directory(save_dir)
	if not _need(reload.data.get_region_count() >= 4, "reload regions missing"): return
	var again := _audit(reload, probe); var reload_mesh: Mesh = reload.bake_mesh(0)
	if not _need(bool(again.get("ok", false)) and int(again.get("samples", 0)) == 66049 and int(again.get("checksum", -1)) == int(audit["checksum"]), "reload semantic parity failed"): return
	if not _need(reload_mesh != null and reload_mesh.get_surface_count() > 0 and _preview(reload), "reload LOD0/preview failed"): return
	var reload_vertices: PackedVector3Array = reload_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	var metrics := {"regionCount": terrain.data.get_region_count(), "gridSamples": audit["samples"], "routeSamples": audit["routeSamples"], "seamSamples": audit["seamSamples"], "maxHeightError": audit["maxHeightError"], "maxBlendError": audit["maxBlendError"], "outputChecksum": audit["checksum"], "bakedVertices": vertices.size(), "savedRegionFiles": saved["files"], "savedRegionBytes": saved["bytes"], "reloadRegionCount": reload.data.get_region_count(), "reloadGridSamples": again["samples"], "reloadChecksum": again["checksum"], "reloadBakedVertices": reload_vertices.size()}
	if not _need(_write_metrics(metrics), "metrics write failed"): return
	print("G77_TERRAIN3D_ROAD_PATH_METRICS=" + JSON.stringify(metrics)); print("SE_G77_TERRAIN3D_ROAD_PATH_VALIDATION_OK"); quit(0)
