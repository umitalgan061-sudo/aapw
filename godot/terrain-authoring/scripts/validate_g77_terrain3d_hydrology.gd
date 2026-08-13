extends SceneTree

const SOURCE_PATH := "res://.terrain3d-proof/g77-hydrology-source.json"
const EXPECTED_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const MAX_HEIGHT_ERROR := 0.012
const MAX_BLEND_ERROR := 0.006
const MAX_COLOR_ERROR := 0.006

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G77 Terrain3D Hydrology proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _value(source: Dictionary, channel: int, u: float, v: float) -> float:
	var rows: Array = source["rows"]
	var gx := clampf(u, 0.0, 1.0) * 64.0
	var gy := clampf(v, 0.0, 1.0) * 64.0
	var x0 := int(floor(gx)); var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, 64); var y1 := mini(y0 + 1, 64)
	var tx := gx - float(x0); var ty := gy - float(y0)
	var a := float(rows[y0][x0][channel]); var b := float(rows[y0][x1][channel])
	var c := float(rows[y1][x0][channel]); var d := float(rows[y1][x1][channel])
	return lerpf(lerpf(a, b, tx), lerpf(c, d, tx), ty)

func _height_image(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			image.set_pixel(x, z, Color(_value(source, 1, float(x) / 256.0, float(z) / 256.0), 0.0, 0.0, 1.0))
	return image

func _control_image(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	var land_id := int(source["landTextureId"]); var coast_id := int(source["coastTextureId"])
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var blend := int(round(clampf(_value(source, 0, float(x) / 256.0, float(z) / 256.0), 0.0, 1.0) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(land_id) | Terrain3DUtil.enc_overlay(coast_id) | Terrain3DUtil.enc_blend(blend)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0.0, 0.0, 1.0))
	return image

func _color_image(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var u := float(x) / 256.0; var v := float(z) / 256.0
			image.set_pixel(x, z, Color(_value(source, 2, u, v), _value(source, 3, u, v), _value(source, 4, u, v), _value(source, 5, u, v)))
	return image

func _write_preview(terrain: Terrain3D, suffix: String) -> bool:
	var image := Image.create_empty(257, 257, false, Image.FORMAT_RGBA8)
	for z in 257:
		for x in 257:
			var p := Vector3(float(x), 0.0, float(z))
			var tint := terrain.data.get_color(p)
			var height := terrain.data.get_height(p)
			if is_nan(height) or is_nan(tint.r): return false
			var relief := clampf((height + 6.0) / 6.75, 0.0, 1.0)
			image.set_pixel(x, z, Color(tint.r * (0.7 + 0.3 * relief), tint.g * (0.7 + 0.3 * relief), tint.b * (0.7 + 0.3 * relief), 1.0))
	var target := "res://.terrain3d-proof/g77-hydrology-imported-topdown-" + suffix + ".png"
	return image.save_png(target) == OK

func _run() -> void:
	if not _require(FileAccess.file_exists(SOURCE_PATH), "source JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(SOURCE_PATH))
	if not _require(parsed is Dictionary, "source JSON invalid"): return
	var source: Dictionary = parsed
	if not _require(String(source.get("schema", "")) == "westeros-g77-terrain3d-hydrology-v1", "source schema changed"): return
	if not _require(String(source.get("sourceMapSha256", "")) == EXPECTED_SHA, "owner map SHA changed"): return
	if not _require(int(source.get("sourceGridSize", 0)) == SOURCE_SIZE, "source size changed"): return
	if not _require(int(source.get("terrain3dRegionSize", 0)) == 256 and int(source.get("terrain3dImportSize", 0)) == IMPORT_SIZE, "Terrain3D import contract changed"): return

	var terrain := Terrain3D.new()
	terrain.name = "G77Terrain3DHydrologyProof"
	get_root().add_child(terrain)
	terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	terrain.data.import_images([_height_image(source), _control_image(source), _color_image(source)], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 4, "257x257 import must create four guard-backed regions"): return

	var max_height_error := 0.0; var max_blend_error := 0.0; var max_color_error := 0.0
	var aligned_samples := 0
	for sy in SOURCE_SIZE:
		for sx in SOURCE_SIZE:
			var p := Vector3(float(sx * 4), 0.0, float(sy * 4))
			var u := float(sx) / 64.0; var v := float(sy) / 64.0
			var height := terrain.data.get_height(p)
			if not _require(not is_nan(height), "height returned NaN"): return
			max_height_error = maxf(max_height_error, absf(height - _value(source, 1, u, v)))
			if not _require(terrain.data.get_control_base_id(p) == int(source["landTextureId"]), "base surface ID changed"): return
			if not _require(terrain.data.get_control_overlay_id(p) == int(source["coastTextureId"]), "coast surface ID changed"): return
			max_blend_error = maxf(max_blend_error, absf(terrain.data.get_control_blend(p) - _value(source, 0, u, v)))
			var color := terrain.data.get_color(p)
			max_color_error = maxf(max_color_error, maxf(absf(color.r - _value(source, 2, u, v)), maxf(absf(color.g - _value(source, 3, u, v)), absf(color.b - _value(source, 4, u, v)))))
			aligned_samples += 1
	if not _require(max_height_error <= MAX_HEIGHT_ERROR, "height roundtrip exceeded tolerance"): return
	if not _require(max_blend_error <= MAX_BLEND_ERROR, "control blend roundtrip exceeded tolerance"): return
	if not _require(max_color_error <= MAX_COLOR_ERROR, "color roundtrip exceeded tolerance"): return

	var seam_samples := 0
	for seam in [254.75, 255.0, 255.25, 255.5, 255.75, 256.0]:
		for cross in [64.5, 128.5, 192.5, 255.5]:
			for p in [Vector3(seam, 0.0, cross), Vector3(cross, 0.0, seam)]:
				if not _require(not is_nan(terrain.data.get_height(p)), "height NaN across 255/256 region seam"): return
				if not _require(not is_nan(terrain.data.get_control_blend(p)), "control NaN across 255/256 region seam"): return
				if not _require(not is_nan(terrain.data.get_color(p).r), "color NaN across 255/256 region seam"): return
				seam_samples += 1

	var mesh: Mesh = terrain.bake_mesh(0)
	if not _require(mesh != null and mesh.get_surface_count() > 0, "LOD0 bake empty"): return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(not vertices.is_empty(), "LOD0 vertices empty"): return
	var suffix := OS.get_environment("G77_HYDROLOGY_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var save_dir := "user://g77-terrain3d-hydrology-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir))
	terrain.data.save_directory(save_dir)
	if not _require(_write_preview(terrain, suffix), "top-down preview write failed"): return
	print("G77_TERRAIN3D_HYDROLOGY_METRICS=" + JSON.stringify({"regions": terrain.data.get_region_count(), "alignedSamples": aligned_samples, "seamSamples": seam_samples, "bakedVertices": vertices.size(), "maxHeightError": max_height_error, "maxBlendError": max_blend_error, "maxColorError": max_color_error}))
	print("SE_G77_TERRAIN3D_HYDROLOGY_OK")
	quit(0)
