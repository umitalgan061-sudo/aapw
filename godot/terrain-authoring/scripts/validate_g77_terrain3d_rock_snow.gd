extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g77-rock-snow-probe.json"
const EXPECTED_POLICY := "kizil-ufuk-g77-terrain3d-rock-snow-2026-08-14-v5"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_BLEND_ERROR := 0.006
const MAX_HEIGHT_ERROR := 0.00001

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G77 Terrain3D rock/snow proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _source_value(probe: Dictionary, u: float, v: float, index: int) -> float:
	var rows: Array = probe["rows"]
	var size := int(probe["sourceGridSize"])
	var gx := clampf(u, 0.0, 1.0) * float(size - 1)
	var gy := clampf(v, 0.0, 1.0) * float(size - 1)
	var x0 := int(floor(gx)); var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, size - 1); var y1 := mini(y0 + 1, size - 1)
	var tx := gx - float(x0); var ty := gy - float(y0)
	var a: Array = rows[y0][x0]; var b: Array = rows[y0][x1]
	var c: Array = rows[y1][x0]; var d: Array = rows[y1][x1]
	var top := lerpf(float(a[index]), float(b[index]), tx)
	var bottom := lerpf(float(c[index]), float(d[index]), tx)
	return lerpf(top, bottom, ty)

func _surface_contract(probe: Dictionary, u: float, v: float) -> Dictionary:
	var rock := clampf(_source_value(probe, u, v, 1), 0.0, 1.0)
	var snow := clampf(_source_value(probe, u, v, 2), 0.0, 1.0)
	var overlay := int(probe["rockTextureId"])
	var blend := rock
	if snow > rock:
		overlay = int(probe["snowTextureId"])
		blend = snow
	return {"overlay": overlay, "blend": blend}

func _build_height_image(probe: Dictionary) -> Image:
	var n := int(probe["terrain3dImportSize"])
	var image := Image.create_empty(n, n, false, Image.FORMAT_RF)
	for z in n:
		var v := float(z) / float(n - 1)
		for x in n:
			var u := float(x) / float(n - 1)
			image.set_pixel(x, z, Color(_source_value(probe, u, v, 4), 0.0, 0.0, 1.0))
	return image

func _build_control_image(probe: Dictionary) -> Image:
	var n := int(probe["terrain3dImportSize"])
	var base_id := int(probe["groundTextureId"])
	var image := Image.create_empty(n, n, false, Image.FORMAT_RF)
	for z in n:
		var v := float(z) / float(n - 1)
		for x in n:
			var u := float(x) / float(n - 1)
			var contract := _surface_contract(probe, u, v)
			var blend_u8 := int(round(float(contract["blend"]) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(base_id) | Terrain3DUtil.enc_overlay(int(contract["overlay"])) | Terrain3DUtil.enc_blend(blend_u8)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0.0, 0.0, 1.0))
	return image

func _write_preview(terrain: Terrain3D, probe: Dictionary) -> Error:
	var n := int(probe["terrain3dImportSize"])
	var image := Image.create_empty(n, n, false, Image.FORMAT_RGBA8)
	for z in n:
		for x in n:
			var pos := Vector3(float(x), 0.0, float(z))
			var blend := terrain.data.get_control_blend(pos)
			if is_nan(blend): blend = 0.0
			var overlay := terrain.data.get_control_overlay_id(pos)
			var ground := Color(0.35, 0.29, 0.20, 1.0)
			var target := Color(0.31, 0.30, 0.28, 1.0) if overlay == int(probe["rockTextureId"]) else Color(0.86, 0.88, 0.90, 1.0)
			image.set_pixel(x, z, ground.lerp(target, clampf(blend, 0.0, 1.0)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	return image.save_png("res://.terrain3d-proof/g77-rock-snow-imported-topdown.png")

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null:
		_fail("Terrain3D save directory missing")
		return {}
	var count := 0; var total_bytes := 0
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			count += 1
			total_bytes += FileAccess.get_file_as_bytes(directory.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end()
	return {"count": count, "bytes": total_bytes}

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON invalid"): return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected policy"): return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "map.png SHA changed"): return
	if not _require(int(probe["terrain3dRegionSize"]) == 256, "region size must be 256"): return
	if not _require(int(probe["terrain3dImportSize"]) == 257, "import size must cross 255/256 region seam"): return

	var terrain := Terrain3D.new()
	terrain.name = "G77Terrain3DRockSnowProof"
	get_root().add_child(terrain)
	terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 not loaded"): return

	terrain.data.import_images([_build_height_image(probe), _build_control_image(probe), null], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 4, "257 import did not span four Terrain3D regions"): return

	var positions: Array[int] = []
	for coordinate in range(0, 257, 16): positions.push_back(coordinate)
	for coordinate in [255, 256]:
		if not positions.has(coordinate): positions.push_back(coordinate)
	positions.sort()
	var max_blend_error := 0.0; var max_height_error := 0.0; var sample_count := 0
	var max_region_seam_blend_error := 0.0; var max_region_seam_height_error := 0.0
	var checksum: int = 2166136261
	for z in positions:
		for x in positions:
			var u := float(x) / 256.0; var v := float(z) / 256.0
			var contract := _surface_contract(probe, u, v)
			var pos := Vector3(float(x), 0.0, float(z))
			if not _require(terrain.data.get_control_base_id(pos) == int(probe["groundTextureId"]), "base texture ID changed"): return
			if not _require(terrain.data.get_control_overlay_id(pos) == int(contract["overlay"]), "overlay texture ID changed"): return
			var actual_blend := terrain.data.get_control_blend(pos)
			if not _require(not is_nan(actual_blend), "control blend NAN"): return
			var blend_error := absf(actual_blend - float(contract["blend"]))
			max_blend_error = maxf(max_blend_error, blend_error)
			var expected_height := _source_value(probe, u, v, 4)
			var height_error := absf(terrain.data.get_height(pos) - expected_height)
			max_height_error = maxf(max_height_error, height_error)
			if x >= 255 or z >= 255:
				max_region_seam_blend_error = maxf(max_region_seam_blend_error, blend_error)
				max_region_seam_height_error = maxf(max_region_seam_height_error, height_error)
			checksum = int((checksum ^ int(round(clampf(actual_blend, 0.0, 1.0) * 255.0))) * 16777619) & 0xffffffff
			sample_count += 1
	if not _require(max_blend_error <= MAX_BLEND_ERROR, "control roundtrip tolerance exceeded"): return
	if not _require(max_height_error <= MAX_HEIGHT_ERROR, "height roundtrip tolerance exceeded"): return
	if not _require(max_region_seam_blend_error <= MAX_BLEND_ERROR, "255/256 control seam roundtrip exceeded tolerance"): return
	if not _require(max_region_seam_height_error <= MAX_HEIGHT_ERROR, "255/256 height seam roundtrip exceeded tolerance"): return
	if not _require(_write_preview(terrain, probe) == OK, "top-down preview write failed"): return

	var baked: Mesh = terrain.bake_mesh(0)
	if not _require(baked != null and baked.get_surface_count() > 0, "LOD0 bake empty"): return
	var vertices: PackedVector3Array = baked.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "LOD0 vertices empty"): return

	var suffix := OS.get_environment("G77_ROCK_SNOW_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var output_dir := "user://g77-terrain3d-rock-snow-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	terrain.data.save_directory(output_dir)
	var saved := _saved_region_evidence(output_dir)
	if not _require(int(saved["count"]) >= 4 and int(saved["bytes"]) > 0, "multi-region persistence empty"): return

	var metrics := {"terrain3dVersion": String(terrain.version), "regionSize": int(terrain.region_size),
		"importSize": int(probe["terrain3dImportSize"]), "regionCount": terrain.data.get_region_count(), "sampleCount": sample_count,
		"maxBlendError": snappedf(max_blend_error, 0.00000001), "maxHeightError": snappedf(max_height_error, 0.00000001),
		"maxRegionSeamBlendError": snappedf(max_region_seam_blend_error, 0.00000001),
		"maxRegionSeamHeightError": snappedf(max_region_seam_height_error, 0.00000001), "outputChecksum": checksum,
		"bakedSurfaces": baked.get_surface_count(), "bakedVertices": vertices.size(), "savedRegionFiles": int(saved["count"]),
		"savedRegionBytes": int(saved["bytes"])}
	print("G77_TERRAIN3D_ROCK_SNOW_METRICS=" + JSON.stringify(metrics))
	print("SE_G77_TERRAIN3D_ROCK_SNOW_VALIDATION_OK")
	quit(0)
