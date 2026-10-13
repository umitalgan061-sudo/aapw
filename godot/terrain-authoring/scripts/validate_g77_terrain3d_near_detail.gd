extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g77-near-detail-probe.json"
const METRICS_PATH := "res://.terrain3d-proof/g77-near-detail-native-metrics.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g77-near-detail-imported-topdown.png"
const EXPECTED_SCHEMA := "westeros-g77-terrain3d-near-detail-probe-v1"
const EXPECTED_POLICY := "kizil-ufuk-g77-terrain3d-near-detail-2026-08-16-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const MAX_HEIGHT_ERROR := 0.00002
const MAX_BLEND_ERROR := 0.006
const MAX_COLOR_ERROR := 0.006
const MAX_ROUGHNESS_ERROR := 0.006
const MAX_SEAM_HEIGHT_ERROR := 0.02
const MAX_SEAM_BLEND_ERROR := 0.006
const MAX_SEAM_COLOR_ERROR := 0.008
const MAX_SEAM_ROUGHNESS_ERROR := 0.008

func _initialize() -> void: call_deferred("_run")
func _fail(message: String) -> void: push_error("G77 Terrain3D Near Detail proof failed: " + message); quit(1)
func _need(ok: bool, message: String) -> bool:
	if not ok: _fail(message); return false
	return true

func _sample(probe: Dictionary, x: int, z: int) -> Array:
	return probe["rows"][z][x]

func _value(probe: Dictionary, channel: int, x: float, z: float) -> float:
	var gx := clampf(x, 0.0, 256.0); var gz := clampf(z, 0.0, 256.0)
	var x0 := int(floor(gx)); var z0 := int(floor(gz)); var x1 := mini(x0 + 1, 256); var z1 := mini(z0 + 1, 256)
	var tx := gx - float(x0); var tz := gz - float(z0); var rows: Array = probe["rows"]
	return lerpf(lerpf(float(rows[z0][x0][channel]), float(rows[z0][x1][channel]), tx), lerpf(float(rows[z1][x0][channel]), float(rows[z1][x1][channel]), tx), tz)

func _images(probe: Dictionary) -> Array:
	var height := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	var control := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	var color := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var s := _sample(probe, x, z)
			height.set_pixel(x, z, Color(float(s[0]), 0, 0, 1))
			var bits: int = Terrain3DUtil.enc_base(int(s[8])) | Terrain3DUtil.enc_overlay(int(s[9])) | Terrain3DUtil.enc_blend(int(s[10]))
			control.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0, 0, 1))
			color.set_pixel(x, z, Color(clampf(float(s[11]), 0, 1), clampf(float(s[12]), 0, 1), clampf(float(s[13]), 0, 1), clampf(float(s[14]), 0, 1)))
	return [height, control, color]

func _audit(terrain: Terrain3D, probe: Dictionary) -> Dictionary:
	var max_h := 0.0; var max_b := 0.0; var max_c := 0.0; var max_r := 0.0
	var samples := 0; var route_samples := 0; var water_samples := 0; var seam_samples := 0; var checksum: int = 2166136261
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var s := _sample(probe, x, z); var pos := Vector3(float(x), 0, float(z))
			var h := terrain.data.get_height(pos); var blend := terrain.data.get_control_blend(pos); var tint := terrain.data.get_color(pos); var rough := terrain.data.get_roughness(pos)
			if is_nan(h) or is_nan(blend) or is_nan(tint.r) or is_nan(tint.g) or is_nan(tint.b) or is_nan(rough): return {"ok": false}
			var actual_base := terrain.data.get_control_base_id(pos); var actual_overlay := terrain.data.get_control_overlay_id(pos)
			if actual_base != int(s[8]): return {"ok": false}
			if int(s[10]) > 0 and actual_overlay != int(s[9]): return {"ok": false}
			max_h = maxf(max_h, absf(h - float(s[0]))); max_b = maxf(max_b, absf(blend - float(s[10]) / 255.0))
			max_c = maxf(max_c, maxf(absf(tint.r - float(s[11])), maxf(absf(tint.g - float(s[12])), absf(tint.b - float(s[13]))))); max_r = maxf(max_r, absf(rough - float(s[14])))
			if maxf(float(s[1]), float(s[2])) > 0.02: route_samples += 1
			if float(s[6]) >= 0.5 and float(s[7]) <= 0.001: water_samples += 1
			if x >= 255 or z >= 255: seam_samples += 1
			for value in [blend, tint.r, tint.g, tint.b, rough]: checksum = int((checksum ^ int(round(clampf(float(value), 0, 1) * 255.0))) * 16777619) & 0xffffffff
			checksum = int((checksum ^ actual_base ^ (actual_overlay << 4)) * 16777619) & 0xffffffff
			samples += 1
	return {"ok": true, "samples": samples, "routeSamples": route_samples, "waterSamples": water_samples, "seamSamples": seam_samples, "maxHeightError": max_h, "maxBlendError": max_b, "maxColorError": max_c, "maxRoughnessError": max_r, "checksum": checksum}

func _seam_audit(terrain: Terrain3D, probe: Dictionary) -> Dictionary:
	var max_h := 0.0; var max_c := 0.0; var max_r := 0.0; var max_b := 0.0
	var fractional_samples := 0; var control_samples := 0
	var seam_positions := [254.75, 255.0, 255.25, 255.5, 255.75, 256.0]
	for cross in [32.5, 96.5, 160.5, 224.5]:
		for seam in seam_positions:
			for p in [Vector3(seam, 0, cross), Vector3(cross, 0, seam)]:
				var h := terrain.data.get_height(p); var tint := terrain.data.get_color(p); var rough := terrain.data.get_roughness(p)
				if is_nan(h) or is_nan(tint.r) or is_nan(tint.g) or is_nan(tint.b) or is_nan(rough): return {"ok": false}
				max_h = maxf(max_h, absf(h - _value(probe, 0, p.x, p.z)))
				var color_error := maxf(absf(tint.r - _value(probe, 11, p.x, p.z)), maxf(absf(tint.g - _value(probe, 12, p.x, p.z)), absf(tint.b - _value(probe, 13, p.x, p.z))))
				max_c = maxf(max_c, color_error); max_r = maxf(max_r, absf(rough - _value(probe, 14, p.x, p.z))); fractional_samples += 1
	for seam in [255, 256]:
		for cross in [32, 96, 160, 224, 255, 256]:
			for p in [Vector3(float(seam), 0, float(cross)), Vector3(float(cross), 0, float(seam))]:
				var s := _sample(probe, int(p.x), int(p.z)); var blend := terrain.data.get_control_blend(p)
				if is_nan(blend) or terrain.data.get_control_base_id(p) != int(s[8]): return {"ok": false}
				if int(s[10]) > 0 and terrain.data.get_control_overlay_id(p) != int(s[9]): return {"ok": false}
				max_b = maxf(max_b, absf(blend - float(s[10]) / 255.0)); control_samples += 1
	return {"ok": true, "fractionalSamples": fractional_samples, "controlSamples": control_samples, "maxHeightError": max_h, "maxBlendError": max_b, "maxColorError": max_c, "maxRoughnessError": max_r}

func _saved(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null: return {"files": 0, "bytes": 0}
	var files := 0; var bytes := 0; dir.list_dir_begin(); var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			var payload := FileAccess.get_file_as_bytes(directory.path_join(name))
			if payload.size() > 0: files += 1; bytes += payload.size()
		name = dir.get_next()
	dir.list_dir_end(); return {"files": files, "bytes": bytes}

func _preview(terrain: Terrain3D) -> bool:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var pos := Vector3(float(x), 0, float(z)); var tint := terrain.data.get_color(pos); var rough := terrain.data.get_roughness(pos)
			if is_nan(tint.r) or is_nan(tint.g) or is_nan(tint.b) or is_nan(rough): return false
			image.set_pixel(x, z, Color(tint.r, tint.g, tint.b, clampf(rough, 0, 1)))
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
	if not _need(String(probe.get("sourceMapSha256", "")) == EXPECTED_MAP_SHA and String(probe.get("geoCell", "")) == "G77" and String(probe.get("layer", "")) == "Near Detail", "provenance drifted"): return
	if not _need(int(probe.get("sourceGridSize", 0)) == IMPORT_SIZE and int(probe.get("terrain3dImportSize", 0)) == IMPORT_SIZE and int(probe.get("terrain3dRegionSize", 0)) == REGION_SIZE, "size contract drifted"): return
	if not _need(int(probe.get("canonicalWaterCells", 0)) == 44 and int(probe.get("canonicalLandCells", 0)) == 52, "G77 44/52 fingerprint drifted"): return
	if not _need(float(probe.get("maxHeightDeltaMeters", 1)) == 0 and float(probe.get("maxRoadPathDelta", 1)) == 0 and float(probe.get("maxControlContractMismatch", 1)) == 0, "predecessor ownership changed"): return

	var terrain := Terrain3D.new(); terrain.name = "G77Terrain3DNearDetail"; get_root().add_child(terrain); terrain.region_size = REGION_SIZE
	if not _need(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D 1.0.2 not loaded"): return
	terrain.data.import_images(_images(probe), Vector3.ZERO, 0, 1)
	if not _need(terrain.data.get_region_count() >= 4, "257 Height+Control+Color import did not create >=4 regions"): return
	var audit := _audit(terrain, probe); var seam := _seam_audit(terrain, probe)
	if not _need(bool(audit.get("ok", false)) and int(audit.get("samples", 0)) == 66049, "full-grid native audit failed"): return
	if not _need(float(audit["maxHeightError"]) <= MAX_HEIGHT_ERROR and float(audit["maxBlendError"]) <= MAX_BLEND_ERROR and float(audit["maxColorError"]) <= MAX_COLOR_ERROR and float(audit["maxRoughnessError"]) <= MAX_ROUGHNESS_ERROR, "native roundtrip tolerance failed"): return
	if not _need(bool(seam.get("ok", false)) and int(seam.get("fractionalSamples", 0)) == 48 and int(seam.get("controlSamples", 0)) == 24, "255/256 region seam audit failed"): return
	if not _need(float(seam["maxHeightError"]) <= MAX_SEAM_HEIGHT_ERROR and float(seam["maxBlendError"]) <= MAX_SEAM_BLEND_ERROR and float(seam["maxColorError"]) <= MAX_SEAM_COLOR_ERROR and float(seam["maxRoughnessError"]) <= MAX_SEAM_ROUGHNESS_ERROR, "255/256 region seam tolerance failed"): return
	if not _need(int(audit["waterSamples"]) > 15000, "canonical water sample population collapsed"): return
	var expected_active := int(probe.get("activeRoadSamples", 0)) + int(probe.get("activePathSamples", 0))
	if not _need((expected_active > 0) == (int(audit["routeSamples"]) > 0), "Road/Path material presence changed"): return
	var mesh: Mesh = terrain.bake_mesh(0); if not _need(mesh != null and mesh.get_surface_count() > 0, "LOD0 bake empty"): return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]; if not _need(vertices.size() > 0, "LOD0 vertices empty"): return

	var suffix := OS.get_environment("G77_NEAR_DETAIL_PROOF_SUFFIX"); if suffix.is_empty(): suffix = "default"
	var save_dir := "user://g77-terrain3d-near-detail-" + suffix; DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir)); terrain.data.save_directory(save_dir)
	var saved := _saved(save_dir); if not _need(int(saved["files"]) >= 4 and int(saved["bytes"]) > 0, "persisted regions missing"): return
	var reload := Terrain3D.new(); reload.name = "G77Terrain3DNearDetailReload"; get_root().add_child(reload); reload.region_size = REGION_SIZE; reload.data.load_directory(save_dir)
	if not _need(reload.data.get_region_count() >= 4, "reload regions missing"): return
	var again := _audit(reload, probe); var again_seam := _seam_audit(reload, probe); var reload_mesh: Mesh = reload.bake_mesh(0)
	if not _need(bool(again.get("ok", false)) and int(again.get("samples", 0)) == 66049 and int(again.get("checksum", -1)) == int(audit["checksum"]), "persist/reload semantic parity failed"): return
	if not _need(bool(again_seam.get("ok", false)) and int(again_seam.get("fractionalSamples", 0)) == 48 and int(again_seam.get("controlSamples", 0)) == 24, "persist/reload 255/256 seam parity failed"): return
	if not _need(float(again_seam["maxHeightError"]) <= MAX_SEAM_HEIGHT_ERROR and float(again_seam["maxBlendError"]) <= MAX_SEAM_BLEND_ERROR and float(again_seam["maxColorError"]) <= MAX_SEAM_COLOR_ERROR and float(again_seam["maxRoughnessError"]) <= MAX_SEAM_ROUGHNESS_ERROR, "persist/reload 255/256 seam tolerance failed"): return
	if not _need(reload_mesh != null and reload_mesh.get_surface_count() > 0 and _preview(reload), "reload LOD0/preview failed"): return
	var reload_vertices: PackedVector3Array = reload_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	var metrics := {"terrain3dVersion": String(terrain.version), "regionSize": int(terrain.region_size), "regionCount": terrain.data.get_region_count(), "gridSamples": audit["samples"], "routeSamples": audit["routeSamples"], "waterSamples": audit["waterSamples"], "seamSamples": audit["seamSamples"], "fractionalSeamSamples": seam["fractionalSamples"], "controlSeamSamples": seam["controlSamples"], "maxSeamHeightError": seam["maxHeightError"], "maxSeamBlendError": seam["maxBlendError"], "maxSeamColorError": seam["maxColorError"], "maxSeamRoughnessError": seam["maxRoughnessError"], "maxHeightError": audit["maxHeightError"], "maxBlendError": audit["maxBlendError"], "maxColorError": audit["maxColorError"], "maxRoughnessError": audit["maxRoughnessError"], "outputChecksum": audit["checksum"], "bakedVertices": vertices.size(), "savedRegionFiles": saved["files"], "savedRegionBytes": saved["bytes"], "reloadRegionCount": reload.data.get_region_count(), "reloadGridSamples": again["samples"], "reloadChecksum": again["checksum"], "reloadFractionalSeamSamples": again_seam["fractionalSamples"], "reloadControlSeamSamples": again_seam["controlSamples"], "reloadMaxSeamHeightError": again_seam["maxHeightError"], "reloadMaxSeamBlendError": again_seam["maxBlendError"], "reloadMaxSeamColorError": again_seam["maxColorError"], "reloadMaxSeamRoughnessError": again_seam["maxRoughnessError"], "reloadBakedVertices": reload_vertices.size()}
	if not _need(_write_metrics(metrics), "metrics write failed"): return
	print("G77_TERRAIN3D_NEAR_DETAIL_METRICS=" + JSON.stringify(metrics)); print("SE_G77_TERRAIN3D_NEAR_DETAIL_VALIDATION_OK"); quit(0)
