extends SceneTree

const PROBE := "res://.terrain3d-proof/g10-canonical-relief-probe.json"
const REGION_SIZE := 256
const IMPORT_SIZE := 257

func _initialize() -> void:
	call_deferred("_run")

func _stop(message: String) -> void:
	push_error("G10 canonical relief Terrain3D proof failed: " + message)
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
			image.set_pixel(x, z, Color(_height(probe, float(x) / 256.0, float(z) / 256.0), 0, 0, 1))
	return image

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

func _run() -> void:
	if not _need(FileAccess.file_exists(PROBE), "probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE))
	if not _need(parsed is Dictionary, "probe JSON invalid"): return
	var probe: Dictionary = parsed
	if not _need(String(probe["schema"]) == "nw-g10-canonical-relief-probe-v1", "schema mismatch"): return
	if not _need(String(probe["policyId"]) == "map-png-continuous-relief-v1", "policy mismatch"): return
	if not _need(String(probe["mapSha256"]) == "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1", "map provenance mismatch"): return
	if not _need(int(probe["sourceGridSize"]) == 65, "source grid mismatch"): return
	if not _need(float(probe["waterMaxAbs"]) <= 0.000000001, "canonical water relief must remain zero"): return
	if not _need(float(probe["maxHeight"]) >= 95.0, "G10 mountain relief too flat"): return

	var terrain := Terrain3D.new()
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _need(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D did not load"): return
	var image := _height_image(probe)
	terrain.data.import_images([image, null, null], Vector3.ZERO, 0.0, 1.0)
	if not _need(terrain.data.get_region_count() >= 4, "257 import must span >=4 Terrain3D regions"): return

	var max_error := 0.0
	var aligned_samples := 0
	for z in range(0, IMPORT_SIZE, 4):
		for x in range(0, IMPORT_SIZE, 4):
			var expected := image.get_pixel(x, z).r
			var actual := terrain.data.get_height(Vector3(x, 0, z))
			if not _need(not is_nan(actual), "NaN imported height"): return
			max_error = maxf(max_error, absf(actual - expected))
			aligned_samples += 1
	if not _need(max_error <= 0.00002, "height round-trip tolerance exceeded"): return

	var seam_samples := 0
	var max_seam_step := 0.0
	for z in range(0, IMPORT_SIZE, 8):
		var a := terrain.data.get_height(Vector3(255, 0, z))
		var b := terrain.data.get_height(Vector3(256, 0, z))
		max_seam_step = maxf(max_seam_step, absf(a - b))
		seam_samples += 1
	for x in range(0, IMPORT_SIZE, 8):
		var a := terrain.data.get_height(Vector3(x, 0, 255))
		var b := terrain.data.get_height(Vector3(x, 0, 256))
		max_seam_step = maxf(max_seam_step, absf(a - b))
		seam_samples += 1

	var mesh: Mesh = terrain.bake_mesh(0)
	if not _need(mesh != null and mesh.get_surface_count() > 0, "LOD0 bake empty"): return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _need(vertices.size() > 0, "LOD0 vertices empty"): return

	var suffix := OS.get_environment("G10_CANONICAL_RELIEF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var output := "user://g10-canonical-relief-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output))
	terrain.data.save_directory(output)
	var saved := _saved_stats(output)
	if not _need(int(saved["files"]) >= 4 and int(saved["bytes"]) > 0, "Terrain3D persistence evidence insufficient"): return

	print("G10_CANONICAL_RELIEF_TERRAIN3D_METRICS=" + JSON.stringify({
		"version": String(terrain.version),
		"regions": terrain.data.get_region_count(),
		"alignedSamples": aligned_samples,
		"maxHeightError": snappedf(max_error, 0.00000001),
		"seamSamples": seam_samples,
		"maxRegionSeamStep": snappedf(max_seam_step, 0.00000001),
		"surfaces": mesh.get_surface_count(),
		"vertices": vertices.size(),
		"savedFiles": int(saved["files"]),
		"savedBytes": int(saved["bytes"]),
	}))
	print("NW_G10_CANONICAL_RELIEF_TERRAIN3D_OK")
	quit(0)
