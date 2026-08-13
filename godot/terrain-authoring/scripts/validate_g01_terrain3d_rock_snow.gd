extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g01-rock-snow-probe.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g01-rock-snow-imported-topdown.png"
const EXPECTED_POLICY := "buzul-muhafizi-g01-terrain3d-rock-snow-2026-08-13-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_BLEND_ERROR := 0.006
const MAX_HEIGHT_ERROR := 0.00002

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G01 Terrain3D rock/snow proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _source_component(probe: Dictionary, u: float, v: float, component: int) -> float:
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
	var a: Array = rows[y0][x0]
	var b: Array = rows[y0][x1]
	var c: Array = rows[y1][x0]
	var d: Array = rows[y1][x1]
	var top := lerpf(float(a[component]), float(b[component]), tx)
	var bottom := lerpf(float(c[component]), float(d[component]), tx)
	return lerpf(top, bottom, ty)

func _build_height_image(probe: Dictionary) -> Image:
	var region_size := int(probe["terrain3dRegionSize"])
	var image := Image.create_empty(region_size, region_size, false, Image.FORMAT_RF)
	for z in region_size:
		var v := float(z) / float(region_size - 1)
		for x in region_size:
			var u := float(x) / float(region_size - 1)
			image.set_pixel(x, z, Color(_source_component(probe, u, v, 4), 0.0, 0.0, 1.0))
	return image

func _build_control_image(probe: Dictionary) -> Image:
	var region_size := int(probe["terrain3dRegionSize"])
	var rock_id := int(probe["rockTextureId"])
	var snow_id := int(probe["snowTextureId"])
	var image := Image.create_empty(region_size, region_size, false, Image.FORMAT_RF)
	for z in region_size:
		var v := float(z) / float(region_size - 1)
		for x in region_size:
			var u := float(x) / float(region_size - 1)
			# Import physical snow weight, not dry-land preference, so canonical
			# water stays at zero overlay mass after Terrain3D quantization.
			var blend_u8 := int(round(clampf(_source_component(probe, u, v, 1), 0.0, 1.0) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(rock_id) | Terrain3DUtil.enc_overlay(snow_id) | Terrain3DUtil.enc_blend(blend_u8)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0.0, 0.0, 1.0))
	return image

func _write_imported_preview(terrain: Terrain3D, probe: Dictionary) -> Error:
	var region_size := int(probe["terrain3dRegionSize"])
	var image := Image.create_empty(region_size, region_size, false, Image.FORMAT_RGBA8)
	for z in region_size:
		for x in region_size:
			var pos := Vector3(float(x), 0.0, float(z))
			var height := terrain.data.get_height(pos)
			var blend := terrain.data.get_control_blend(pos)
			if is_nan(height) or is_nan(blend):
				return ERR_INVALID_DATA
			var water := height < 0.0
			var rock := Color(0.25, 0.28, 0.31, 1.0)
			var snow := Color(0.91, 0.95, 0.97, 1.0)
			var sea := Color(0.08, 0.18, 0.25, 1.0)
			image.set_pixel(x, z, sea if water else rock.lerp(snow, clampf(blend, 0.0, 1.0)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	return image.save_png(PREVIEW_PATH)

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null:
		_fail("Terrain3D save directory was not created")
		return {}
	var files: Array[String] = []
	var total_bytes := 0
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			files.push_back(name)
			total_bytes += FileAccess.get_file_as_bytes(directory.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end()
	files.sort()
	return {"files": files, "totalBytes": total_bytes}

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "G01 rock/snow probe JSON missing"):
		return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON did not decode to Dictionary"):
		return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected G01 rock/snow policy"):
		return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "owner-map SHA changed"):
		return
	if not _require(int(probe["terrain3dRegionSize"]) == 256, "proof must use Terrain3D region size 256"):
		return
	if not _require(float(probe["maxG00SharedSeamRockWeightDelta"]) <= 0.000001 and float(probe["maxG00SharedSeamSnowWeightDelta"]) <= 0.000001, "G00/G01 material seam parity changed"):
		return

	var terrain := Terrain3D.new()
	terrain.name = "G01Terrain3DRockSnowProof"
	get_root().add_child(terrain)
	terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"):
		return

	var height_image := _build_height_image(probe)
	var control_image := _build_control_image(probe)
	terrain.data.import_images([height_image, control_image, null], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() == 1, "Terrain3D rock/snow import must produce exactly one region"):
		return

	var rock_id := int(probe["rockTextureId"])
	var snow_id := int(probe["snowTextureId"])
	var positions: Array[int] = []
	for coordinate in range(0, 256, 16):
		positions.push_back(coordinate)
	if positions[-1] != 255:
		positions.push_back(255)
	var max_blend_error := 0.0
	var max_height_error := 0.0
	var blend_checksum: int = 2166136261
	var sample_count := 0
	var water_like_zero_blend_samples := 0
	for z in positions:
		for x in positions:
			var u := float(x) / 255.0
			var v := float(z) / 255.0
			var pos := Vector3(float(x), 0.0, float(z))
			var expected_blend := clampf(_source_component(probe, u, v, 1), 0.0, 1.0)
			var expected_height := _source_component(probe, u, v, 4)
			var actual_base := terrain.data.get_control_base_id(pos)
			var actual_overlay := terrain.data.get_control_overlay_id(pos)
			var actual_blend := terrain.data.get_control_blend(pos)
			var actual_height := terrain.data.get_height(pos)
			if not _require(actual_base == rock_id, "Terrain3D control base texture ID changed"):
				return
			if not _require(actual_overlay == snow_id, "Terrain3D control overlay texture ID changed"):
				return
			if not _require(not is_nan(actual_blend) and not is_nan(actual_height), "Terrain3D control/height returned NaN"):
				return
			max_blend_error = maxf(max_blend_error, absf(actual_blend - expected_blend))
			max_height_error = maxf(max_height_error, absf(actual_height - expected_height))
			if expected_height < 0.0 and expected_blend <= 0.000001 and actual_blend <= MAX_BLEND_ERROR:
				water_like_zero_blend_samples += 1
			var quantized := int(round(clampf(actual_blend, 0.0, 1.0) * 255.0))
			blend_checksum = int((blend_checksum ^ quantized) * 16777619) & 0xffffffff
			sample_count += 1
	if not _require(max_blend_error <= MAX_BLEND_ERROR, "Terrain3D control-map roundtrip exceeded tolerance"):
		return
	if not _require(max_height_error <= MAX_HEIGHT_ERROR, "Terrain3D relief roundtrip changed during rock/snow import"):
		return
	if not _require(water_like_zero_blend_samples > 0, "Terrain3D proof did not retain any zero-snow water-like samples"):
		return

	if not _require(_write_imported_preview(terrain, probe) == OK, "failed to write imported G01 rock/snow preview"):
		return
	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "Terrain3D LOD0 rock/snow bake returned no mesh"):
		return
	var arrays := baked_mesh.surface_get_arrays(0)
	var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "Terrain3D LOD0 rock/snow bake returned no vertices"):
		return

	var suffix := OS.get_environment("G01_ROCK_SNOW_PROOF_SUFFIX")
	if suffix.is_empty():
		suffix = "default"
	var output_dir := "user://g01-terrain3d-rock-snow-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	terrain.data.save_directory(output_dir)
	var saved := _saved_region_evidence(output_dir)
	if not _require(saved["files"].size() >= 1 and int(saved["totalBytes"]) > 0, "Terrain3D G01 rock/snow region resource was not persisted"):
		return

	print("G01_TERRAIN3D_ROCK_SNOW_METRICS=" + JSON.stringify({
		"terrain3dVersion": String(terrain.version),
		"regionSize": int(terrain.region_size),
		"regionCount": terrain.data.get_region_count(),
		"sampleCount": sample_count,
		"maxBlendError": snappedf(max_blend_error, 0.00000001),
		"maxHeightError": snappedf(max_height_error, 0.00000001),
		"waterLikeZeroBlendSamples": water_like_zero_blend_samples,
		"blendChecksum": blend_checksum,
		"bakedSurfaces": baked_mesh.get_surface_count(),
		"bakedVertices": vertices.size(),
		"savedRegionFiles": saved["files"].size(),
		"savedRegionBytes": int(saved["totalBytes"]),
		"previewPath": PREVIEW_PATH,
	}))
	print("NW_G01_TERRAIN3D_ROCK_SNOW_VALIDATION_OK")
	quit(0)
