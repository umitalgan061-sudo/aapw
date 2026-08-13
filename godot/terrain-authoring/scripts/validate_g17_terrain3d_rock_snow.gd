extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g17-rock-snow-probe.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g17-rock-snow-imported-topdown.png"
const EXPECTED_POLICY := "gunbatimi-ustasi-g17-terrain3d-rock-snow-2026-08-13-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_HEIGHT_ERROR := 0.012
const MAX_BLEND_ERROR := 0.006
const MAX_SEAM_HEIGHT_ERROR := 0.02
const MAX_SEAM_BLEND_ERROR := 0.006

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G17 Terrain3D Rock/Snow proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _source_value(probe: Dictionary, channel: int, u: float, v: float) -> float:
	var rows: Array = probe["rows"]
	var size := int(probe["sourceGridSize"])
	var gx := clampf(u, 0.0, 1.0) * float(size - 1)
	var gy := clampf(v, 0.0, 1.0) * float(size - 1)
	var x0 := int(floor(gx)); var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, size - 1); var y1 := mini(y0 + 1, size - 1)
	var tx := gx - float(x0); var ty := gy - float(y0)
	var a := float(rows[y0][x0][channel]); var b := float(rows[y0][x1][channel])
	var c := float(rows[y1][x0][channel]); var d := float(rows[y1][x1][channel])
	return lerpf(lerpf(a, b, tx), lerpf(c, d, tx), ty)

func _build_height_image(probe: Dictionary) -> Image:
	var n := int(probe["terrain3dImportSize"])
	var image := Image.create_empty(n, n, false, Image.FORMAT_RF)
	for z in n:
		for x in n:
			image.set_pixel(x, z, Color(_source_value(probe, 4, float(x)/(n-1), float(z)/(n-1)), 0, 0, 1))
	return image

func _build_control_image(probe: Dictionary) -> Image:
	var n := int(probe["terrain3dImportSize"])
	var base_id := int(probe["seabedTextureId"]); var rock_id := int(probe["rockTextureId"])
	var image := Image.create_empty(n, n, false, Image.FORMAT_RF)
	for z in n:
		for x in n:
			var u := float(x)/(n-1); var v := float(z)/(n-1)
			var blend := int(round(clampf(_source_value(probe, 3, u, v), 0, 1) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(base_id) | Terrain3DUtil.enc_overlay(rock_id) | Terrain3DUtil.enc_blend(blend)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0, 0, 1))
	return image

func _saved_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null: return {"files": 0, "bytes": 0}
	var files := 0; var bytes := 0
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			files += 1
			bytes += FileAccess.get_file_as_bytes(directory.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end()
	return {"files": files, "bytes": bytes}

func _write_preview(terrain: Terrain3D, size: int) -> bool:
	var image := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	for z in size:
		for x in size:
			var blend := terrain.data.get_control_blend(Vector3(x, 0, z))
			if is_nan(blend): return false
			image.set_pixel(x, z, Color(0.10, 0.19, 0.22, 1).lerp(Color(0.20, 0.22, 0.23, 1), clampf(blend, 0, 1)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(PREVIEW_PATH).get_base_dir())
	return image.save_png(PREVIEW_PATH) == OK

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON invalid"): return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected policy"): return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "owner-map SHA changed"): return
	if not _require(int(probe["sourceGridSize"]) == 65, "source grid must be 65x65"): return
	if not _require(int(probe["terrain3dRegionSize"]) == 256 and int(probe["terrain3dImportSize"]) == 257, "expected 257 import / 256 region"): return

	var max_snow := 0.0
	for row in probe["rows"]:
		for sample in row: max_snow = maxf(max_snow, float(sample[2]))
	if not _require(max_snow <= 0.00000001, "G17 open sea invented snow"): return

	var terrain := Terrain3D.new()
	terrain.name = "G17Terrain3DRockSnowProof"
	get_root().add_child(terrain)
	terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	terrain.data.import_images([_build_height_image(probe), _build_control_image(probe), null], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 4, "257x257 Height+Control import must create >=4 regions"): return

	var base_id := int(probe["seabedTextureId"]); var rock_id := int(probe["rockTextureId"])
	var max_height_error := 0.0; var max_blend_error := 0.0; var checksum: int = 2166136261; var aligned := 0
	for sy in 65:
		for sx in 65:
			var x := sx * 4; var z := sy * 4; var u := float(sx)/64.0; var v := float(sy)/64.0
			var p := Vector3(x, 0, z); var h := terrain.data.get_height(p); var blend := terrain.data.get_control_blend(p)
			if not _require(not is_nan(h) and not is_nan(blend), "Terrain3D returned NaN"): return
			if not _require(terrain.data.get_control_base_id(p) == base_id and terrain.data.get_control_overlay_id(p) == rock_id, "control texture IDs changed"): return
			max_height_error = maxf(max_height_error, absf(h - _source_value(probe, 4, u, v)))
			max_blend_error = maxf(max_blend_error, absf(blend - _source_value(probe, 3, u, v)))
			checksum = int((checksum ^ int(round(clampf(blend, 0, 1) * 255.0))) * 16777619) & 0xffffffff
			aligned += 1
	if not _require(max_height_error <= MAX_HEIGHT_ERROR, "height roundtrip exceeded tolerance"): return
	if not _require(max_blend_error <= MAX_BLEND_ERROR, "control roundtrip exceeded tolerance"): return

	var seam_positions := [254.75, 255.0, 255.25, 255.5, 255.75, 256.0]
	var max_seam_height := 0.0; var max_seam_blend := 0.0; var seam_samples := 0
	for cross in [64.5, 128.5, 192.5, 255.5]:
		for seam in seam_positions:
			for p in [Vector3(seam, 0, cross), Vector3(cross, 0, seam)]:
				var u := p.x / 256.0; var v := p.z / 256.0
				var h := terrain.data.get_height(p); var blend := terrain.data.get_control_blend(p)
				if not _require(not is_nan(h) and not is_nan(blend), "NaN at Terrain3D region seam"): return
				max_seam_height = maxf(max_seam_height, absf(h - _source_value(probe, 4, u, v)))
				max_seam_blend = maxf(max_seam_blend, absf(blend - _source_value(probe, 3, u, v)))
				seam_samples += 1
	if not _require(max_seam_height <= MAX_SEAM_HEIGHT_ERROR, "region seam height parity exceeded tolerance"): return
	if not _require(max_seam_blend <= MAX_SEAM_BLEND_ERROR, "region seam blend parity exceeded tolerance"): return

	var mesh: Mesh = terrain.bake_mesh(0)
	if not _require(mesh != null and mesh.get_surface_count() > 0, "LOD0 bake returned no mesh"): return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "LOD0 bake returned no vertices"): return
	var suffix := OS.get_environment("G17_ROCK_SNOW_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var output := "user://g17-terrain3d-rock-snow-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output))
	terrain.data.save_directory(output)
	var saved := _saved_evidence(output)
	if not _require(int(saved["files"]) >= 4 and int(saved["bytes"]) > 0, "Terrain3D regions were not persisted"): return
	if not _require(_write_preview(terrain, 257), "failed to write imported top-down evidence"): return

	var metrics := {"terrain3dVersion": String(terrain.version), "regionCount": terrain.data.get_region_count(), "alignedSamples": aligned,
		"seamSamples": seam_samples, "maxHeightError": snappedf(max_height_error, 0.00000001), "maxBlendError": snappedf(max_blend_error, 0.00000001),
		"maxSeamHeightError": snappedf(max_seam_height, 0.00000001), "maxSeamBlendError": snappedf(max_seam_blend, 0.00000001),
		"maxSourceSnowWeight": snappedf(max_snow, 0.00000001), "outputChecksum": checksum, "bakedSurfaces": mesh.get_surface_count(),
		"bakedVertices": vertices.size(), "savedRegionFiles": int(saved["files"]), "savedRegionBytes": int(saved["bytes"])}
	print("G17_TERRAIN3D_ROCK_SNOW_METRICS=" + JSON.stringify(metrics))
	print("SW_G17_TERRAIN3D_ROCK_SNOW_VALIDATION_OK")
	quit(0)
