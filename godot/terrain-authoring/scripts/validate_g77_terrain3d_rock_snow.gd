extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g77-rock-snow-probe.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g77-rock-snow-imported-topdown.png"
const EXPECTED_POLICY := "kizil-ufuk-g77-terrain3d-rock-snow-2026-08-14-r9"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_BLEND_ERROR := 0.006
const MAX_HEIGHT_ERROR := 0.00002
const IMPORT_SIZE := 257
const REGION_SIZE := 256

func _initialize() -> void: call_deferred("_run")
func _fail(message: String) -> void: push_error("G77 Terrain3D Rock/Snow proof failed: " + message); quit(1)
func _need(ok: bool, message: String) -> bool:
	if not ok: _fail(message); return false
	return true

func _source_value(probe: Dictionary, u: float, v: float, channel: int) -> float:
	var rows: Array = probe["rows"]; var size := int(probe["sourceGridSize"])
	var gx := clampf(u, 0.0, 1.0) * float(size - 1); var gy := clampf(v, 0.0, 1.0) * float(size - 1)
	var x0 := int(floor(gx)); var y0 := int(floor(gy)); var x1 := mini(x0 + 1, size - 1); var y1 := mini(y0 + 1, size - 1)
	var tx := gx - float(x0); var ty := gy - float(y0)
	var a: Array = rows[y0][x0]; var b: Array = rows[y0][x1]; var c: Array = rows[y1][x0]; var d: Array = rows[y1][x1]
	return lerpf(lerpf(float(a[channel]), float(b[channel]), tx), lerpf(float(c[channel]), float(d[channel]), tx), ty)

func _expected_control(probe: Dictionary, u: float, v: float) -> Dictionary:
	var rock := clampf(_source_value(probe, u, v, 1), 0.0, 1.0); var snow := clampf(_source_value(probe, u, v, 2), 0.0, 1.0)
	return {"overlay": int(probe["snowTextureId"]) if snow > rock else int(probe["rockTextureId"]), "blend": maxf(rock, snow)}

func _images(probe: Dictionary) -> Array:
	var height := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	var control := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var u := float(x) / 256.0; var v := float(z) / 256.0; var expected := _expected_control(probe, u, v)
			height.set_pixel(x, z, Color(_source_value(probe, u, v, 4), 0, 0, 1))
			var bits := Terrain3DUtil.enc_base(int(probe["groundTextureId"])) | Terrain3DUtil.enc_overlay(int(expected["overlay"])) | Terrain3DUtil.enc_blend(int(round(float(expected["blend"]) * 255.0)))
			control.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0, 0, 1))
	return [height, control, null]

func _audit(terrain: Variant, probe: Dictionary) -> Dictionary:
	var max_h := 0.0; var max_b := 0.0; var seam_h := 0.0; var seam_b := 0.0; var count := 0; var checksum: int = 2166136261
	var positions: Array[int] = []
	for value in range(0, IMPORT_SIZE, 16): positions.push_back(value)
	for value in [255, 256]: if not positions.has(value): positions.push_back(value)
	positions.sort()
	for z in positions:
		for x in positions:
			var u := float(x) / 256.0; var v := float(z) / 256.0; var expected := _expected_control(probe, u, v); var pos := Vector3(x, 0, z)
			var h := terrain.data.get_height(pos); var blend := terrain.data.get_control_blend(pos)
			if is_nan(h) or is_nan(blend): return {}
			var base_ok := terrain.data.get_control_base_id(pos) == int(probe["groundTextureId"]); var overlay_materialized := int(round(float(expected["blend"]) * 255.0)) > 0
			if not base_ok or (overlay_materialized and terrain.data.get_control_overlay_id(pos) != int(expected["overlay"])): return {}
			var he := absf(h - _source_value(probe, u, v, 4)); var be := absf(blend - float(expected["blend"]))
			max_h = maxf(max_h, he); max_b = maxf(max_b, be)
			if x >= 255 or z >= 255: seam_h = maxf(seam_h, he); seam_b = maxf(seam_b, be)
			checksum = int((checksum ^ int(round(clampf(blend, 0, 1) * 255.0))) * 16777619) & 0xffffffff; count += 1
	return {"maxHeightError": max_h, "maxBlendError": max_b, "seamHeightError": seam_h, "seamBlendError": seam_b, "count": count, "checksum": checksum}

func _saved_stats(directory: String) -> Dictionary:
	var absolute := ProjectSettings.globalize_path(directory); var dir := DirAccess.open(absolute)
	if dir == null: return {"files": 0, "bytes": 0}
	var files := 0; var bytes := 0; dir.list_dir_begin(); var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			var payload := FileAccess.get_file_as_bytes(absolute.path_join(name))
			if payload.size() > 0: files += 1; bytes += payload.size()
		name = dir.get_next()
	dir.list_dir_end(); return {"files": files, "bytes": bytes}

func _write_preview(terrain: Variant, probe: Dictionary) -> bool:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	var ground := Color(0.34, 0.30, 0.24, 1.0); var rock := Color(0.34, 0.34, 0.33, 1.0); var snow := Color(0.90, 0.92, 0.94, 1.0)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var pos := Vector3(x, 0, z); var blend := terrain.data.get_control_blend(pos)
			if is_nan(blend): return false
			var target := snow if terrain.data.get_control_overlay_id(pos) == int(probe["snowTextureId"]) else rock
			image.set_pixel(x, z, ground.lerp(target, clampf(blend, 0.0, 1.0)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(PREVIEW_PATH).get_base_dir())
	return image.save_png(PREVIEW_PATH) == OK

func _run() -> void:
	if not _need(FileAccess.file_exists(PROBE_PATH), "probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH)); if not _need(parsed is Dictionary, "probe JSON invalid"): return
	var probe: Dictionary = parsed
	if not _need(String(probe["policyId"]) == EXPECTED_POLICY and String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "policy/map provenance mismatch"): return
	if not _need(String(probe["geoCell"]) == "G77" and String(probe["layer"]) == "Rock/Snow", "identity mismatch"): return
	if not _need(int(probe["terrain3dRegionSize"]) == REGION_SIZE and int(probe["terrain3dImportSize"]) == IMPORT_SIZE, "region/import contract mismatch"): return
	if not _need(ClassDB.class_exists("Terrain3D"), "Terrain3D class not registered"): return
	var terrain: Variant = ClassDB.instantiate("Terrain3D"); if not _need(terrain != null, "Terrain3D instantiate failed"): return
	get_root().add_child(terrain); terrain.region_size = REGION_SIZE
	if not _need(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D 1.0.2 not loaded"): return
	print("G77_T3D_STAGE=import")
	terrain.data.import_images(_images(probe), Vector3.ZERO, 0.0, 1.0)
	if not _need(terrain.data.get_region_count() >= 4, "257 import did not span >=4 regions"): return
	print("G77_T3D_STAGE=audit")
	var audit := _audit(terrain, probe)
	if not _need(not audit.is_empty() and float(audit["maxBlendError"]) <= MAX_BLEND_ERROR and float(audit["seamBlendError"]) <= MAX_BLEND_ERROR, "control roundtrip failed"): return
	if not _need(float(audit["maxHeightError"]) <= MAX_HEIGHT_ERROR and float(audit["seamHeightError"]) <= MAX_HEIGHT_ERROR, "height roundtrip failed"): return
	print("G77_T3D_STAGE=bake")
	var baked: Mesh = terrain.bake_mesh(0); if not _need(baked != null and baked.get_surface_count() > 0, "LOD0 bake empty"): return
	var vertices: PackedVector3Array = baked.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]; if not _need(vertices.size() > 0, "LOD0 vertices empty"): return
	var suffix := OS.get_environment("G77_ROCK_SNOW_PROOF_SUFFIX"); if suffix.is_empty(): suffix = "default"
	var out_dir := "user://g77-rock-snow-r9-" + suffix; DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(out_dir)); terrain.data.save_directory(out_dir)
	print("G77_T3D_STAGE=persist")
	var saved := _saved_stats(out_dir); if not _need(int(saved["files"]) >= 4 and int(saved["bytes"]) > 0, "persisted multi-region data missing"): return
	var reloaded: Variant = ClassDB.instantiate("Terrain3D"); if not _need(reloaded != null, "Terrain3D reload instantiate failed"): return
	get_root().add_child(reloaded); reloaded.region_size = REGION_SIZE; reloaded.data.load_directory(out_dir)
	print("G77_T3D_STAGE=reload")
	if not _need(reloaded.data.get_region_count() >= 4, "persisted multi-region reload failed"): return
	var reload_audit := _audit(reloaded, probe)
	if not _need(not reload_audit.is_empty() and int(reload_audit["checksum"]) == int(audit["checksum"]), "save/reload semantic parity failed"): return
	if not _need(float(reload_audit["maxHeightError"]) <= MAX_HEIGHT_ERROR and float(reload_audit["maxBlendError"]) <= MAX_BLEND_ERROR, "save/reload tolerance failed"): return
	var reload_bake: Mesh = reloaded.bake_mesh(0); if not _need(reload_bake != null and reload_bake.get_surface_count() > 0, "reloaded LOD0 bake empty"): return
	print("G77_T3D_STAGE=preview")
	if not _need(_write_preview(reloaded, probe), "imported top-down preview write failed"): return
	print("G77_TERRAIN3D_ROCK_SNOW_METRICS=" + JSON.stringify({"regionCount": terrain.data.get_region_count(), "sampleCount": int(audit["count"]), "maxBlendError": audit["maxBlendError"], "maxHeightError": audit["maxHeightError"], "seamBlendError": audit["seamBlendError"], "seamHeightError": audit["seamHeightError"], "checksum": audit["checksum"], "bakedSurfaces": baked.get_surface_count(), "bakedVertices": vertices.size(), "savedFiles": saved["files"], "savedBytes": saved["bytes"], "reloadRegionCount": reloaded.data.get_region_count(), "reloadChecksum": reload_audit["checksum"], "reloadBakedSurfaces": reload_bake.get_surface_count()}))
	print("SE_G77_TERRAIN3D_ROCK_SNOW_VALIDATION_OK"); quit(0)