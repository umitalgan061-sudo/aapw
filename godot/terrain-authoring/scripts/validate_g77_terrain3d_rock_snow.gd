extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g77-rock-snow-probe.json"
const EXPECTED_POLICY := "kizil-ufuk-g77-terrain3d-rock-snow-2026-08-14-r9"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_BLEND_ERROR := 0.006
const MAX_HEIGHT_ERROR := 0.00002

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G77 Terrain3D Rock/Snow proof failed: " + message)
	quit(1)

func _need(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _source_value(probe: Dictionary, u: float, v: float, channel: int) -> float:
	var rows: Array = probe["rows"]
	var size := int(probe["sourceGridSize"])
	var gx := clampf(u, 0.0, 1.0) * float(size - 1)
	var gy := clampf(v, 0.0, 1.0) * float(size - 1)
	var x0 := int(floor(gx)); var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, size - 1); var y1 := mini(y0 + 1, size - 1)
	var tx := gx - float(x0); var ty := gy - float(y0)
	var a: Array = rows[y0][x0]; var b: Array = rows[y0][x1]
	var c: Array = rows[y1][x0]; var d: Array = rows[y1][x1]
	return lerpf(lerpf(float(a[channel]), float(b[channel]), tx), lerpf(float(c[channel]), float(d[channel]), tx), ty)

func _surface_contract(probe: Dictionary, u: float, v: float) -> Dictionary:
	var rock := clampf(_source_value(probe, u, v, 1), 0.0, 1.0)
	var snow := clampf(_source_value(probe, u, v, 2), 0.0, 1.0)
	var overlay := int(probe["rockTextureId"])
	var blend := rock
	if snow > rock:
		overlay = int(probe["snowTextureId"])
		blend = snow
	return {"overlay": overlay, "blend": blend}

func _height_image(probe: Dictionary) -> Image:
	var n := int(probe["terrain3dImportSize"])
	var image := Image.create_empty(n, n, false, Image.FORMAT_RF)
	for z in n:
		for x in n:
			image.set_pixel(x, z, Color(_source_value(probe, float(x) / 256.0, float(z) / 256.0, 4), 0, 0, 1))
	return image

func _control_image(probe: Dictionary) -> Image:
	var n := int(probe["terrain3dImportSize"])
	var image := Image.create_empty(n, n, false, Image.FORMAT_RF)
	for z in n:
		for x in n:
			var contract := _surface_contract(probe, float(x) / 256.0, float(z) / 256.0)
			var bits := Terrain3DUtil.enc_base(int(probe["groundTextureId"])) | Terrain3DUtil.enc_overlay(int(contract["overlay"])) | Terrain3DUtil.enc_blend(int(round(float(contract["blend"]) * 255.0)))
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0, 0, 1))
	return image

func _run() -> void:
	if not _need(FileAccess.file_exists(PROBE_PATH), "probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _need(parsed is Dictionary, "probe JSON invalid"): return
	var probe: Dictionary = parsed
	if not _need(String(probe["policyId"]) == EXPECTED_POLICY, "policy mismatch"): return
	if not _need(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "map.png SHA mismatch"): return
	if not _need(String(probe["geoCell"]) == "G77" and String(probe["layer"]) == "Rock/Snow", "identity mismatch"): return
	if not _need(int(probe["terrain3dRegionSize"]) == 256 and int(probe["terrain3dImportSize"]) == 257, "region/import contract mismatch"): return
	var terrain := Terrain3D.new()
	terrain.region_size = 256
	get_root().add_child(terrain)
	if not _need(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D 1.0.2 not loaded"): return
	terrain.data.import_images([_height_image(probe), _control_image(probe), null], Vector3.ZERO, 0.0, 1.0)
	if not _need(terrain.data.get_region_count() >= 4, "257 import did not span >=4 regions"): return
	var max_blend_error := 0.0; var max_height_error := 0.0; var seam_blend_error := 0.0; var seam_height_error := 0.0
	var sample_count := 0; var checksum: int = 2166136261
	var positions: Array[int] = []
	for value in range(0, 257, 16): positions.push_back(value)
	for value in [255, 256]: if not positions.has(value): positions.push_back(value)
	positions.sort()
	for z in positions:
		for x in positions:
			var u := float(x) / 256.0; var v := float(z) / 256.0; var expected := _surface_contract(probe, u, v)
			var pos := Vector3(float(x), 0, float(z))
			if not _need(terrain.data.get_control_base_id(pos) == int(probe["groundTextureId"]), "base ID mismatch"): return
			if not _need(terrain.data.get_control_overlay_id(pos) == int(expected["overlay"]), "overlay ID mismatch"): return
			var blend := terrain.data.get_control_blend(pos); var height := terrain.data.get_height(pos)
			if not _need(not is_nan(blend) and not is_nan(height), "non-finite Terrain3D sample"): return
			var be := absf(blend - float(expected["blend"])); var he := absf(height - _source_value(probe, u, v, 4))
			max_blend_error = maxf(max_blend_error, be); max_height_error = maxf(max_height_error, he)
			if x >= 255 or z >= 255: seam_blend_error = maxf(seam_blend_error, be); seam_height_error = maxf(seam_height_error, he)
			checksum = int((checksum ^ int(round(clampf(blend, 0, 1) * 255.0))) * 16777619) & 0xffffffff; sample_count += 1
	if not _need(max_blend_error <= MAX_BLEND_ERROR and seam_blend_error <= MAX_BLEND_ERROR, "control roundtrip tolerance exceeded"): return
	if not _need(max_height_error <= MAX_HEIGHT_ERROR and seam_height_error <= MAX_HEIGHT_ERROR, "height roundtrip tolerance exceeded"): return
	var baked: Mesh = terrain.bake_mesh(0)
	if not _need(baked != null and baked.get_surface_count() > 0, "LOD0 bake empty"): return
	var vertices: PackedVector3Array = baked.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _need(vertices.size() > 0, "LOD0 vertices empty"): return
	var suffix := OS.get_environment("G77_ROCK_SNOW_PROOF_SUFFIX"); if suffix.is_empty(): suffix = "default"
	var out_dir := "user://g77-rock-snow-r9-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(out_dir)); terrain.data.save_directory(out_dir)
	var dir := DirAccess.open(out_dir); if not _need(dir != null, "save directory missing"): return
	var files := 0; var bytes := 0; dir.list_dir_begin(); var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir(): files += 1; bytes += FileAccess.get_file_as_bytes(out_dir.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end()
	if not _need(files >= 4 and bytes > 0, "persisted multi-region data missing"): return
	print("G77_TERRAIN3D_ROCK_SNOW_METRICS=" + JSON.stringify({"regionCount": terrain.data.get_region_count(), "sampleCount": sample_count, "maxBlendError": max_blend_error, "maxHeightError": max_height_error, "seamBlendError": seam_blend_error, "seamHeightError": seam_height_error, "checksum": checksum, "bakedSurfaces": baked.get_surface_count(), "bakedVertices": vertices.size(), "savedFiles": files, "savedBytes": bytes}))
	print("SE_G77_TERRAIN3D_ROCK_SNOW_VALIDATION_OK")
	quit(0)
