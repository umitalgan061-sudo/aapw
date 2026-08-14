extends SceneTree

const PROBE := "res://.terrain3d-proof/g10-relief-probe.json"
const DENSE := "res://.terrain3d-proof/g10-relief-dense.json"
const PREVIEW := "res://.terrain3d-proof/g10-relief-imported-topdown.png"
const POLICY := "buzul-muhafizi-g10-terrain3d-relief-2026-08-14-v2"
const REGION_SIZE := 256
const IMPORT_SIZE := 257

func _initialize() -> void:
	call_deferred("_run")

func _stop(message: String) -> void:
	push_error("G10 Terrain3D relief proof failed: " + message)
	quit(1)

func _need(ok: bool, message: String) -> bool:
	if not ok:
		_stop(message)
		return false
	return true

func _height(probe: Dictionary, u: float, v: float) -> float:
	var rows: Array = probe["rows"]
	var size := int(probe["sourceGridSize"])
	var gx := clampf(u, 0.0, 1.0) * float(size - 1)
	var gy := clampf(v, 0.0, 1.0) * float(size - 1)
	var x0 := int(floor(gx))
	var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, size - 1)
	var y1 := mini(y0 + 1, size - 1)
	var tx := gx - float(x0)
	var ty := gy - float(y0)
	var top := lerpf(float(rows[y0][x0]), float(rows[y0][x1]), tx)
	var bottom := lerpf(float(rows[y1][x0]), float(rows[y1][x1]), tx)
	return lerpf(top, bottom, ty)

func _height_image(probe: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var h := _height(probe, float(x) / float(IMPORT_SIZE - 1), float(z) / float(IMPORT_SIZE - 1))
			image.set_pixel(x, z, Color(h, 0, 0, 1))
	return image

func _preview(terrain: Terrain3D, lo: float, hi: float) -> bool:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGB8)
	var span := maxf(hi - lo, 0.0001)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var h := terrain.data.get_height(Vector3(x, 0, z))
			if is_nan(h):
				return false
			var t := clampf((h - lo) / span, 0.0, 1.0)
			var snow_hint := smoothstep(0.66, 0.92, t)
			image.set_pixel(x, z, Color(0.20 + 0.62 * t, 0.27 + 0.55 * t, 0.24 + 0.70 * snow_hint))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(PREVIEW).get_base_dir())
	return image.save_png(PREVIEW) == OK

func _saved_stats(directory: String) -> Dictionary:
	var absolute := ProjectSettings.globalize_path(directory)
	var dir := DirAccess.open(absolute)
	if dir == null:
		return {"files": 0, "bytes": 0}
	var files := 0
	var bytes := 0
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			var content := FileAccess.get_file_as_bytes(absolute.path_join(name))
			if content.size() > 0:
				files += 1
				bytes += content.size()
		name = dir.get_next()
	dir.list_dir_end()
	return {"files": files, "bytes": bytes}

func _aligned_audit(terrain: Terrain3D, image: Image) -> Dictionary:
	var max_error := 0.0
	var checksum: int = 2166136261
	var samples := 0
	for z in range(0, IMPORT_SIZE, 4):
		for x in range(0, IMPORT_SIZE, 4):
			var expected := image.get_pixel(x, z).r
			var actual := terrain.data.get_height(Vector3(x, 0, z))
			if is_nan(actual):
				_stop("NaN imported height")
				return {}
			max_error = maxf(max_error, absf(actual - expected))
			checksum = int((checksum ^ int(round((actual + 256.0) * 10000.0))) * 16777619) & 0xffffffff
			samples += 1
	return {"samples": samples, "maxError": max_error, "checksum": checksum}

func _seam_audit(terrain: Terrain3D) -> Dictionary:
	var max_step := 0.0
	var samples := 0
	for z in range(0, IMPORT_SIZE, 8):
		var a := terrain.data.get_height(Vector3(255, 0, z))
		var b := terrain.data.get_height(Vector3(256, 0, z))
		if is_nan(a) or is_nan(b):
			_stop("NaN Terrain3D region seam")
			return {}
		max_step = maxf(max_step, absf(a - b))
		samples += 1
	for x in range(0, IMPORT_SIZE, 8):
		var a := terrain.data.get_height(Vector3(x, 0, 255))
		var b := terrain.data.get_height(Vector3(x, 0, 256))
		if is_nan(a) or is_nan(b):
			_stop("NaN Terrain3D region seam")
			return {}
		max_step = maxf(max_step, absf(a - b))
		samples += 1
	return {"samples": samples, "maxStep": max_step}

func _run() -> void:
	if not _need(FileAccess.file_exists(PROBE), "probe JSON missing"): return
	if not _need(FileAccess.file_exists(DENSE), "dense continuity JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE))
	var dense_parsed = JSON.parse_string(FileAccess.get_file_as_string(DENSE))
	if not _need(parsed is Dictionary and dense_parsed is Dictionary, "proof JSON invalid"): return
	var probe: Dictionary = parsed
	var dense: Dictionary = dense_parsed
	if not _need(String(probe["policyId"]) == POLICY, "policy mismatch"): return
	if not _need(String(dense["policyId"]) == POLICY, "dense policy mismatch"): return
	if not _need(int(probe["canonicalWaterCells"]) == 60 and int(probe["canonicalLandCells"]) == 36, "hydrology fingerprint drift"): return
	if not _need(int(probe["canonicalSignMismatches"]) == 0, "canonical height sign mismatch"): return
	if not _need(int(dense["denseSamples"]) == 66049, "dense sample contract drift"): return

	var terrain := Terrain3D.new()
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _need(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D did not load"): return
	var image := _height_image(probe)
	terrain.data.import_images([image, null, null], Vector3.ZERO, 0.0, 1.0)
	if not _need(terrain.data.get_region_count() >= 4, "257 import must span at least four Terrain3D regions"): return

	var audit := _aligned_audit(terrain, image)
	if audit.is_empty(): return
	if not _need(float(audit["maxError"]) <= 0.00002, "height round-trip tolerance exceeded"): return
	var seam := _seam_audit(terrain)
	if seam.is_empty(): return
	if not _need(float(seam["maxStep"]) <= float(dense["maxGridHeightCrossingDelta"]) + 0.05, "Terrain3D 255/256 seam exceeded source continuity"): return

	var mesh: Mesh = terrain.bake_mesh(0)
	if not _need(mesh != null and mesh.get_surface_count() > 0, "LOD0 bake empty"): return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _need(vertices.size() > 0, "LOD0 vertices empty"): return

	var suffix := OS.get_environment("G10_RELIEF_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var output := "user://g10-terrain3d-relief-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output))
	terrain.data.save_directory(output)
	var saved := _saved_stats(output)
	if not _need(int(saved["files"]) >= 4 and int(saved["bytes"]) > 0, "Terrain3D persistence evidence insufficient"): return
	if not _need(_preview(terrain, float(probe["minHeight"]), float(probe["maxHeight"])), "imported preview failed"): return

	print("G10_TERRAIN3D_RELIEF_METRICS=" + JSON.stringify({
		"version": String(terrain.version),
		"regions": terrain.data.get_region_count(),
		"samples": int(audit["samples"]),
		"maxHeightError": snappedf(float(audit["maxError"]), 0.00000001),
		"checksum": int(audit["checksum"]),
		"seamSamples": int(seam["samples"]),
		"maxRegionSeamStep": snappedf(float(seam["maxStep"]), 0.00000001),
		"surfaces": mesh.get_surface_count(),
		"vertices": vertices.size(),
		"savedFiles": int(saved["files"]),
		"savedBytes": int(saved["bytes"]),
	}))
	print("NW_G10_TERRAIN3D_RELIEF_VALIDATION_OK")
	quit(0)
