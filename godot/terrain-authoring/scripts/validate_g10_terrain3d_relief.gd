extends SceneTree

const PROBE := "res://.terrain3d-proof/g10-relief-probe.json"
const PREVIEW := "res://.terrain3d-proof/g10-relief-imported-topdown.png"
const POLICY := "buzul-muhafizi-g10-terrain3d-relief-2026-08-13-v1"

func _initialize() -> void: call_deferred("_run")
func _stop(message: String) -> void: push_error("G10 Terrain3D relief proof failed: " + message); quit(1)
func _need(ok: bool, message: String) -> bool:
	if not ok: _stop(message); return false
	return true

func _height(probe: Dictionary, u: float, v: float) -> float:
	var rows: Array = probe["rows"]; var size := int(probe["sourceGridSize"])
	var gx := clampf(u, 0.0, 1.0) * float(size - 1); var gy := clampf(v, 0.0, 1.0) * float(size - 1)
	var x0 := int(floor(gx)); var y0 := int(floor(gy)); var x1 := mini(x0 + 1, size - 1); var y1 := mini(y0 + 1, size - 1)
	return lerpf(lerpf(float(rows[y0][x0]), float(rows[y0][x1]), gx - x0), lerpf(float(rows[y1][x0]), float(rows[y1][x1]), gx - x0), gy - y0)

func _image(probe: Dictionary) -> Image:
	var size := int(probe["terrain3dRegionSize"]); var image := Image.create_empty(size, size, false, Image.FORMAT_RF)
	for z in size:
		for x in size: image.set_pixel(x, z, Color(_height(probe, float(x) / (size - 1), float(z) / (size - 1)), 0, 0, 1))
	return image

func _preview(terrain: Terrain3D, lo: float, hi: float) -> bool:
	var image := Image.create_empty(256, 256, false, Image.FORMAT_RGB8); var span := maxf(hi - lo, 0.0001)
	for z in 256:
		for x in 256:
			var h := terrain.data.get_height(Vector3(x, 0, z)); if is_nan(h): return false
			var t := clampf((h - lo) / span, 0, 1); image.set_pixel(x, z, Color(t, t, t))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(PREVIEW).get_base_dir())
	return image.save_png(PREVIEW) == OK

func _saved_files(directory: String) -> int:
	var dir := DirAccess.open(directory); if dir == null: return 0
	var count := 0; dir.list_dir_begin(); var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir() and FileAccess.get_file_as_bytes(directory.path_join(name)).size() > 0: count += 1
		name = dir.get_next()
	dir.list_dir_end(); return count

func _run() -> void:
	if not _need(FileAccess.file_exists(PROBE), "probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE)); if not _need(parsed is Dictionary, "probe JSON invalid"): return
	var probe: Dictionary = parsed
	if not _need(String(probe["policyId"]) == POLICY, "policy mismatch"): return
	if not _need(int(probe["canonicalWaterCells"]) == 60 and int(probe["canonicalLandCells"]) == 36 and int(probe["canonicalSignMismatches"]) == 0, "hydrology regression"): return
	var terrain := Terrain3D.new(); get_root().add_child(terrain); terrain.region_size = 256
	if not _need(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D did not load"): return
	var image := _image(probe); terrain.data.import_images([image, null, null], Vector3.ZERO, 0.0, 1.0)
	if not _need(terrain.data.get_region_count() == 1, "expected one Terrain3D region"): return
	var max_error := 0.0; var checksum: int = 2166136261; var samples := 0
	for z in range(0, 256, 16):
		for x in range(0, 256, 16):
			var actual := terrain.data.get_height(Vector3(x, 0, z)); if is_nan(actual): _stop("NaN imported height"); return
			max_error = maxf(max_error, absf(actual - image.get_pixel(x, z).r)); checksum = int((checksum ^ int(round((actual + 128) * 1000))) * 16777619) & 0xffffffff; samples += 1
	if not _need(max_error <= 0.00002, "height round-trip tolerance exceeded"): return
	var mesh: Mesh = terrain.bake_mesh(0); if not _need(mesh != null and mesh.get_surface_count() > 0, "LOD0 bake empty"): return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]; if not _need(vertices.size() > 0, "LOD0 vertices empty"): return
	var suffix := OS.get_environment("G10_RELIEF_PROOF_SUFFIX"); if suffix.is_empty(): suffix = "default"
	var output := "user://g10-terrain3d-relief-" + suffix; DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output)); terrain.data.save_directory(output)
	var saved := _saved_files(output); if not _need(saved > 0, "region persistence empty"): return
	if not _need(_preview(terrain, float(probe["minHeight"]), float(probe["maxHeight"])), "preview failed"): return
	print("G10_TERRAIN3D_RELIEF_METRICS=" + JSON.stringify({"version":String(terrain.version),"regions":terrain.data.get_region_count(),"samples":samples,"maxHeightError":snappedf(max_error,0.00000001),"checksum":checksum,"surfaces":mesh.get_surface_count(),"vertices":vertices.size(),"savedFiles":saved}))
	print("NW_G10_TERRAIN3D_RELIEF_VALIDATION_OK"); quit(0)
