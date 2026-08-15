extends SceneTree

const SOURCE_PATH := "res://.terrain3d-proof/g60-runtime-source.json"
const BAKE_PATH := "res://.terrain3d-proof/g60-runtime-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g60-runtime-bake-topdown.png"
const EXPECTED_SCHEMA := "westeros-g60-terrain3d-runtime-source-v1"
const EXPECTED_POLICY := "safak-kartali-g60-terrain3d-threejs-runtime-parity-2026-08-15-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const HEIGHT_TOLERANCE := 0.015
const UNIT_TOLERANCE := 0.006
const SEAM_HEIGHT_TOLERANCE := 0.025
const SEAM_UNIT_TOLERANCE := 0.008

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G60 Terrain3D runtime parity proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _channel(source: Dictionary, name: String, u: float, v: float) -> float:
	var values: Array = source[name]
	var gx := clampf(u, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var gy := clampf(v, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var x0 := int(floor(gx)); var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, SOURCE_SIZE - 1); var y1 := mini(y0 + 1, SOURCE_SIZE - 1)
	var tx := gx - float(x0); var ty := gy - float(y0)
	var a := float(values[y0 * SOURCE_SIZE + x0]); var b := float(values[y0 * SOURCE_SIZE + x1])
	var c := float(values[y1 * SOURCE_SIZE + x0]); var d := float(values[y1 * SOURCE_SIZE + x1])
	return lerpf(lerpf(a, b, tx), lerpf(c, d, tx), ty)

func _source_color(source: Dictionary, u: float, v: float) -> Color:
	return Color(
		clampf(_channel(source, "tintR", u, v), 0.0, 1.0),
		clampf(_channel(source, "tintG", u, v), 0.0, 1.0),
		clampf(_channel(source, "tintB", u, v), 0.0, 1.0),
		clampf(_channel(source, "roughness", u, v), 0.0, 1.0)
	)

func _build_height(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			image.set_pixel(x, z, Color(_channel(source, "heights", float(x) / 256.0, float(z) / 256.0), 0.0, 0.0, 1.0))
	return image

func _build_control(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var blend := int(round(clampf(_channel(source, "controlBlend", float(x) / 256.0, float(z) / 256.0), 0.0, 1.0) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(0) | Terrain3DUtil.enc_overlay(1) | Terrain3DUtil.enc_blend(blend)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0.0, 0.0, 1.0))
	return image

func _build_color(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			image.set_pixel(x, z, _source_color(source, float(x) / 256.0, float(z) / 256.0))
	return image

func _saved_regions(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null: return {"files": 0, "bytes": 0}
	var files := 0; var bytes := 0
	dir.list_dir_begin(); var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			files += 1; bytes += FileAccess.get_file_as_bytes(directory.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end()
	return {"files": files, "bytes": bytes}

func _write_preview(terrain: Terrain3D) -> Error:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var pos := Vector3(float(x), 0.0, float(z))
			var color := terrain.data.get_color(pos)
			var roughness := terrain.data.get_roughness(pos)
			if is_nan(color.r) or is_nan(roughness): return ERR_INVALID_DATA
			image.set_pixel(x, z, Color(color.r, color.g, color.b, clampf(roughness, 0.0, 1.0)))
	return image.save_png(PREVIEW_PATH)

func _hash_byte(checksum: int, value: int) -> int:
	return int((checksum ^ (value & 0xff)) * 16777619) & 0xffffffff

func _run() -> void:
	if not _require(FileAccess.file_exists(SOURCE_PATH), "runtime source JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(SOURCE_PATH))
	if not _require(parsed is Dictionary, "runtime source did not decode to Dictionary"): return
	var source: Dictionary = parsed
	if not _require(String(source.get("schema", "")) == EXPECTED_SCHEMA, "unexpected source schema"): return
	if not _require(String(source.get("policyId", "")) == EXPECTED_POLICY, "unexpected runtime parity policy"): return
	if not _require(String(source.get("sourceMapSha256", "")) == EXPECTED_MAP_SHA, "map provenance changed"): return
	if not _require(int(source.get("width", 0)) == SOURCE_SIZE and int(source.get("height", 0)) == SOURCE_SIZE, "source must remain 65x65"): return
	for channel in ["heights", "controlBlend", "tintR", "tintG", "tintB", "roughness"]:
		if not _require(source.has(channel) and source[channel] is Array and (source[channel] as Array).size() == SOURCE_SIZE * SOURCE_SIZE, "invalid source channel " + channel): return

	var terrain := Terrain3D.new()
	terrain.name = "G60Terrain3DRuntimeParityProof"
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	terrain.data.import_images([_build_height(source), _build_control(source), _build_color(source)], Vector3.ZERO, 0.0, 1.0)
	var region_count := terrain.data.get_region_count()
	if not _require(region_count >= 4, "257x257 import did not create >=4 Terrain3D regions"): return

	var heights: Array[float] = []; var blends: Array[float] = []
	var tint_r: Array[float] = []; var tint_g: Array[float] = []; var tint_b: Array[float] = []; var roughness_values: Array[float] = []
	var max_height_error := 0.0; var max_blend_error := 0.0; var max_color_error := 0.0; var max_roughness_error := 0.0
	var checksum: int = 2166136261
	for sy in SOURCE_SIZE:
		var v := float(sy) / 64.0
		for sx in SOURCE_SIZE:
			var u := float(sx) / 64.0; var pos := Vector3(float(sx * 4), 0.0, float(sy * 4))
			var h := terrain.data.get_height(pos); var blend := terrain.data.get_control_blend(pos)
			var color := terrain.data.get_color(pos); var roughness := terrain.data.get_roughness(pos)
			if not _require(not is_nan(h) and not is_nan(blend) and not is_nan(color.r) and not is_nan(roughness), "non-finite aligned Terrain3D sample"): return
			if not _require(terrain.data.get_control_base_id(pos) == 0 and terrain.data.get_control_overlay_id(pos) == 1, "Terrain3D control texture IDs drifted"): return
			var expected_color := _source_color(source, u, v)
			max_height_error = maxf(max_height_error, absf(h - _channel(source, "heights", u, v)))
			max_blend_error = maxf(max_blend_error, absf(blend - _channel(source, "controlBlend", u, v)))
			max_color_error = maxf(max_color_error, maxf(absf(color.r - expected_color.r), maxf(absf(color.g - expected_color.g), absf(color.b - expected_color.b))))
			max_roughness_error = maxf(max_roughness_error, absf(roughness - expected_color.a))
			heights.push_back(snappedf(h, 0.000001)); blends.push_back(snappedf(blend, 0.00000001))
			tint_r.push_back(snappedf(color.r, 0.00000001)); tint_g.push_back(snappedf(color.g, 0.00000001)); tint_b.push_back(snappedf(color.b, 0.00000001)); roughness_values.push_back(snappedf(roughness, 0.00000001))
			for value in [blend, color.r, color.g, color.b, roughness]: checksum = _hash_byte(checksum, int(round(clampf(value, 0.0, 1.0) * 255.0)))
	if not _require(max_height_error <= HEIGHT_TOLERANCE and max_blend_error <= UNIT_TOLERANCE, "height/control parity exceeded tolerance"): return
	if not _require(max_color_error <= UNIT_TOLERANCE and max_roughness_error <= UNIT_TOLERANCE, "color/roughness parity exceeded tolerance"): return

	var seam_height_error := 0.0; var seam_unit_error := 0.0; var seam_samples := 0
	for seam in [255.0, 256.0]:
		for cross in [0.0, 64.0, 128.0, 192.0, 255.0, 256.0]:
			for pos in [Vector3(seam, 0.0, cross), Vector3(cross, 0.0, seam)]:
				var u: float = float(pos.x) / 256.0
				var v: float = float(pos.z) / 256.0
				var expected_color := _source_color(source, u, v); var color := terrain.data.get_color(pos)
				seam_height_error = maxf(seam_height_error, absf(terrain.data.get_height(pos) - _channel(source, "heights", u, v)))
				seam_unit_error = maxf(seam_unit_error, absf(terrain.data.get_control_blend(pos) - _channel(source, "controlBlend", u, v)))
				seam_unit_error = maxf(seam_unit_error, maxf(absf(color.r - expected_color.r), maxf(absf(color.g - expected_color.g), absf(color.b - expected_color.b))))
				seam_unit_error = maxf(seam_unit_error, absf(terrain.data.get_roughness(pos) - expected_color.a)); seam_samples += 1
	if not _require(seam_height_error <= SEAM_HEIGHT_TOLERANCE and seam_unit_error <= SEAM_UNIT_TOLERANCE, "255/256 seam parity exceeded tolerance"): return

	var mesh: Mesh = terrain.bake_mesh(0)
	if not _require(mesh != null and mesh.get_surface_count() > 0, "Terrain3D LOD0 bake returned no mesh"): return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "Terrain3D LOD0 bake returned no vertices"): return
	var suffix := OS.get_environment("G60_RUNTIME_PARITY_PROOF_SUFFIX"); if suffix.is_empty(): suffix = "default"
	var save_dir := "user://g60-terrain3d-runtime-parity-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir)); terrain.data.save_directory(save_dir)
	var saved := _saved_regions(save_dir)
	if not _require(int(saved["files"]) >= 4 and int(saved["bytes"]) > 0, "Terrain3D did not persist >=4 regions"): return
	if not _require(_write_preview(terrain) == OK, "failed to write Terrain3D top-down preview"): return

	var bake := {
		"schema":"westeros-g60-terrain3d-runtime-bake-v1", "policyId":EXPECTED_POLICY, "sourceMapSha256":EXPECTED_MAP_SHA,
		"terrain3dVersion":String(terrain.version), "lod":0, "width":SOURCE_SIZE, "height":SOURCE_SIZE,
		"regionCount":region_count, "savedRegionFiles":int(saved["files"]), "savedRegionBytes":int(saved["bytes"]),
		"bakedSurfaces":mesh.get_surface_count(), "bakedVertices":vertices.size(), "alignedSamples":SOURCE_SIZE * SOURCE_SIZE,
		"seamSamples":seam_samples, "maxHeightError":snappedf(max_height_error,0.00000001), "maxBlendError":snappedf(max_blend_error,0.00000001),
		"maxColorError":snappedf(max_color_error,0.00000001), "maxRoughnessError":snappedf(max_roughness_error,0.00000001),
		"maxSeamHeightError":snappedf(seam_height_error,0.00000001), "maxSeamUnitError":snappedf(seam_unit_error,0.00000001), "bakeChecksum":checksum,
		"heights":heights, "controlBlend":blends, "tintR":tint_r, "tintG":tint_g, "tintB":tint_b, "roughness":roughness_values
	}
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	var output := FileAccess.open(BAKE_PATH, FileAccess.WRITE)
	if not _require(output != null, "could not open runtime bake JSON output"): return
	output.store_string(JSON.stringify(bake) + "\n"); output.close()
	print("G60_TERRAIN3D_RUNTIME_BAKE_METRICS=" + JSON.stringify({"regions":region_count,"vertices":vertices.size(),"seamSamples":seam_samples,"maxHeightError":bake["maxHeightError"],"maxBlendError":bake["maxBlendError"],"maxColorError":bake["maxColorError"],"maxRoughnessError":bake["maxRoughnessError"],"maxSeamHeightError":bake["maxSeamHeightError"],"maxSeamUnitError":bake["maxSeamUnitError"],"bakeChecksum":checksum}))
	print("NE_G60_TERRAIN3D_RUNTIME_BAKE_OK")
	quit(0)
