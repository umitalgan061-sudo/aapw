extends SceneTree

const SOURCE_PATH := "res://.terrain3d-proof/g71-biome-source.json"
const BAKE_PATH := "res://.terrain3d-proof/g71-biome-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g71-biome-topdown.png"
const EXPECTED_SCHEMA := "westeros-g71-terrain3d-biome-source-v1"
const EXPECTED_POLICY := "safak-kartali-g71-terrain3d-biome-2026-08-14-v1"
const EXPECTED_HYDROLOGY_POLICY := "safak-kartali-g71-hydrology-2026-08-12-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const HEIGHT_TOLERANCE := 0.001
const COLOR_TOLERANCE := 0.006
const ROUGHNESS_TOLERANCE := 0.006

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G71 Terrain3D biome proof failed: " + message)
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

func _height_image(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var v := _channel(source, "heights", float(x) / 256.0, float(z) / 256.0)
			image.set_pixel(x, z, Color(v, 0.0, 0.0, 1.0))
	return image

func _color_image(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var u := float(x) / 256.0; var v := float(z) / 256.0
			image.set_pixel(x, z, Color(_channel(source, "colorR", u, v), _channel(source, "colorG", u, v), _channel(source, "colorB", u, v), _channel(source, "roughness", u, v)))
	return image

func _write_preview(terrain: Terrain3D) -> Error:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var p := Vector3(float(x), 0.0, float(z))
			var c := terrain.data.get_color(p); var r := terrain.data.get_roughness(p)
			if is_nan(c.r) or is_nan(c.g) or is_nan(c.b) or is_nan(r): return ERR_INVALID_DATA
			image.set_pixel(x, z, Color(c.r, c.g, c.b, clampf(r, 0.0, 1.0)))
	return image.save_png(PREVIEW_PATH)

func _run() -> void:
	if not _require(FileAccess.file_exists(SOURCE_PATH), "G71 biome source JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(SOURCE_PATH))
	if not _require(parsed is Dictionary, "source JSON invalid"): return
	var source: Dictionary = parsed
	if not _require(String(source.get("schema", "")) == EXPECTED_SCHEMA, "schema drifted"): return
	if not _require(String(source.get("policyId", "")) == EXPECTED_POLICY, "policy drifted"): return
	if not _require(String(source.get("hydrologyPolicyId", "")) == EXPECTED_HYDROLOGY_POLICY, "hydrology provenance drifted"): return
	if not _require(String(source.get("sourceMapSha256", "")) == EXPECTED_MAP_SHA, "map provenance drifted"): return
	if not _require(String(source.get("geoCell", "")) == "G71", "GeoCell drifted"): return
	for name in ["heights", "waterConfidence", "colorR", "colorG", "colorB", "roughness"]:
		if not _require(source.has(name) and source[name] is Array and (source[name] as Array).size() == SOURCE_SIZE * SOURCE_SIZE, "invalid channel " + name): return
	for value in source["waterConfidence"]:
		if not _require(absf(float(value) - 1.0) <= 0.00000001, "G71 source invented non-sea confidence"): return

	var terrain := Terrain3D.new()
	terrain.name = "G71Terrain3DBiomeProof"
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	terrain.data.import_images([_height_image(source), null, _color_image(source)], Vector3.ZERO, 0.0, 1.0)
	var regions := terrain.data.get_region_count()
	if not _require(regions >= 4, "257x257 import did not create >=4 regions"): return

	var max_h := 0.0; var max_c := 0.0; var max_r := 0.0
	for sy in SOURCE_SIZE:
		for sx in SOURCE_SIZE:
			var u := float(sx) / 64.0; var v := float(sy) / 64.0
			var pos := Vector3(float(sx * 4), 0.0, float(sy * 4))
			var h := terrain.data.get_height(pos); var c := terrain.data.get_color(pos); var r := terrain.data.get_roughness(pos)
			if not _require(not is_nan(h) and not is_nan(c.r) and not is_nan(c.g) and not is_nan(c.b) and not is_nan(r), "Terrain3D returned NAN"): return
			if not _require(h <= -2.5, "G71 seafloor rose above canonical open-water contract"): return
			max_h = maxf(max_h, absf(h - _channel(source, "heights", u, v)))
			max_c = maxf(max_c, maxf(absf(c.r - _channel(source, "colorR", u, v)), maxf(absf(c.g - _channel(source, "colorG", u, v)), absf(c.b - _channel(source, "colorB", u, v)))))
			max_r = maxf(max_r, absf(r - _channel(source, "roughness", u, v)))
	if not _require(max_h <= HEIGHT_TOLERANCE, "height round-trip exceeded tolerance"): return
	if not _require(max_c <= COLOR_TOLERANCE, "color round-trip exceeded tolerance"): return
	if not _require(max_r <= ROUGHNESS_TOLERANCE, "roughness round-trip exceeded tolerance"): return

	var seam_h := absf(terrain.data.get_height(Vector3(255,0,128)) - terrain.data.get_height(Vector3(256,0,128)))
	var seam_c := terrain.data.get_color(Vector3(255,0,128)).distance_to(terrain.data.get_color(Vector3(256,0,128)))
	var seam_r := absf(terrain.data.get_roughness(Vector3(128,0,255)) - terrain.data.get_roughness(Vector3(128,0,256)))
	if not _require(seam_h <= HEIGHT_TOLERANCE and seam_c <= 0.01 and seam_r <= 0.01, "255/256 Terrain3D seam drifted"): return

	var mesh: Mesh = terrain.bake_mesh(0)
	if not _require(mesh != null and mesh.get_surface_count() > 0, "LOD0 bake returned no mesh"): return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "LOD0 bake returned no vertices"): return
	var suffix := OS.get_environment("G71_BIOME_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var save_dir := "user://g71-terrain3d-biome-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir))
	terrain.data.save_directory(save_dir)
	var dir := DirAccess.open(save_dir); var saved_files := 0
	if not _require(dir != null, "save directory missing"): return
	dir.list_dir_begin(); var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir(): saved_files += 1
		name = dir.get_next()
	dir.list_dir_end()
	if not _require(saved_files >= 4, "Terrain3D did not persist >=4 region files"): return
	if not _require(_write_preview(terrain) == OK, "failed to write Terrain3D top-down preview"): return
	var evidence := {"geoCell":"G71","regions":regions,"savedRegionFiles":saved_files,"lod0Vertices":vertices.size(),"maxHeightError":max_h,"maxColorError":max_c,"maxRoughnessError":max_r,"seamHeight":seam_h,"seamColor":seam_c,"seamRoughness":seam_r}
	FileAccess.open(BAKE_PATH, FileAccess.WRITE).store_string(JSON.stringify(evidence) + "\n")
	print("G71_TERRAIN3D_BIOME_BAKE=" + JSON.stringify(evidence))
	print("NE_G71_TERRAIN3D_BIOME_VALIDATION_OK")
	quit(0)
