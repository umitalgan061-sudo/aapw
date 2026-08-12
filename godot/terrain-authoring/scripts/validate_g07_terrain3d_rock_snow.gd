extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g07-rock-snow-probe.json"
const EXPECTED_POLICY := "gunbatimi-ustasi-g07-terrain3d-rock-snow-2026-08-13-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_BLEND_ERROR := 0.006

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G07 Terrain3D rock/snow proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _source_blend(probe: Dictionary, u: float, v: float) -> float:
	var rows: Array = probe["rows"]
	var size := int(probe["sourceGridSize"])
	var gx := clampf(u, 0.0, 1.0) * float(size - 1)
	var gy := clampf(v, 0.0, 1.0) * float(size - 1)
	var x0 := int(floor(gx)); var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, size - 1); var y1 := mini(y0 + 1, size - 1)
	var tx := gx - float(x0); var ty := gy - float(y0)
	var a: Array = rows[y0][x0]; var b: Array = rows[y0][x1]
	var c: Array = rows[y1][x0]; var d: Array = rows[y1][x1]
	return clampf(lerpf(lerpf(float(a[0]), float(b[0]), tx), lerpf(float(c[0]), float(d[0]), tx), ty), 0.0, 1.0)

func _build_height_image(region_size: int) -> Image:
	var image := Image.create_empty(region_size, region_size, false, Image.FORMAT_RF)
	image.fill(Color(-7.5, 0.0, 0.0, 1.0))
	return image

func _build_control_image(probe: Dictionary) -> Image:
	var size := int(probe["terrain3dRegionSize"])
	var base_id := int(probe["substrateTextureId"])
	var rock_id := int(probe["rockTextureId"])
	var image := Image.create_empty(size, size, false, Image.FORMAT_RF)
	for z in size:
		var v := float(z) / float(size - 1)
		for x in size:
			var u := float(x) / float(size - 1)
			var blend_u8 := int(round(_source_blend(probe, u, v) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(base_id) | Terrain3DUtil.enc_overlay(rock_id) | Terrain3DUtil.enc_blend(blend_u8)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0.0, 0.0, 1.0))
	return image

func _write_preview(terrain: Terrain3D) -> Error:
	var size := 256
	var image := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	for z in size:
		for x in size:
			var blend := terrain.data.get_control_blend(Vector3(float(x), 0.0, float(z)))
			if is_nan(blend): blend = 0.0
			image.set_pixel(x, z, Color(0.12, 0.18, 0.20, 1.0).lerp(Color(0.34, 0.36, 0.38, 1.0), clampf(blend, 0.0, 1.0)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	return image.save_png("res://.terrain3d-proof/g07-rock-snow-imported-topdown.png")

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe did not decode to Dictionary"): return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected policy"): return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "owner-map SHA changed"): return
	if not _require(int(probe["terrain3dRegionSize"]) == 256, "region size must be 256"): return

	var terrain := Terrain3D.new(); terrain.name = "G07Terrain3DRockSnowProof"; get_root().add_child(terrain); terrain.region_size = 256
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	var control := _build_control_image(probe)
	terrain.data.import_images([_build_height_image(256), control, null], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() >= 1, "control import produced no region"): return

	var positions: Array[int] = []
	for coordinate in range(0, 256, 16): positions.push_back(coordinate)
	if positions[-1] != 255: positions.push_back(255)
	var max_error := 0.0; var checksum: int = 2166136261; var sample_count := 0
	for z in positions:
		for x in positions:
			var expected := _source_blend(probe, float(x) / 255.0, float(z) / 255.0)
			var pos := Vector3(float(x), 0.0, float(z))
			if not _require(terrain.data.get_control_base_id(pos) == int(probe["substrateTextureId"]), "base texture changed"): return
			if not _require(terrain.data.get_control_overlay_id(pos) == int(probe["rockTextureId"]), "rock overlay changed"): return
			var actual := terrain.data.get_control_blend(pos)
			if not _require(not is_nan(actual), "blend returned NaN"): return
			max_error = maxf(max_error, absf(actual - expected))
			checksum = int((checksum ^ int(round(clampf(actual, 0.0, 1.0) * 255.0))) * 16777619) & 0xffffffff
			sample_count += 1
	if not _require(max_error <= MAX_BLEND_ERROR, "control-map roundtrip exceeded tolerance"): return
	if not _require(_write_preview(terrain) == OK, "failed to write imported top-down preview"): return

	var baked: Mesh = terrain.bake_mesh(0)
	if not _require(baked != null and baked.get_surface_count() > 0, "LOD0 bake returned no mesh"): return
	var vertices: PackedVector3Array = baked.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "LOD0 bake returned no vertices"): return
	var suffix := OS.get_environment("G07_ROCK_SNOW_PROOF_SUFFIX"); if suffix.is_empty(): suffix = "default"
	var out := "user://g07-terrain3d-rock-snow-proof-" + suffix; DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(out)); terrain.data.save_directory(out)
	var dir := DirAccess.open(out)
	if not _require(dir != null, "save directory missing"): return
	var files := 0; var bytes := 0; dir.list_dir_begin(); var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir(): files += 1; bytes += FileAccess.get_file_as_bytes(out.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end()
	if not _require(files >= 1 and bytes > 0, "region data was not persisted"): return
	var metrics := {"terrain3dVersion":String(terrain.version),"regionCount":terrain.data.get_region_count(),"sampleCount":sample_count,"maxBlendError":snappedf(max_error,0.00000001),"outputChecksum":checksum,"bakedSurfaces":baked.get_surface_count(),"bakedVertices":vertices.size(),"savedRegionFiles":files,"savedRegionBytes":bytes}
	print("G07_TERRAIN3D_ROCK_SNOW_METRICS=" + JSON.stringify(metrics))
	print("SW_G07_TERRAIN3D_ROCK_SNOW_VALIDATION_OK")
	quit(0)
