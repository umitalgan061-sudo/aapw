extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g60-rock-snow-probe.json"
const METRICS_PATH := "res://.terrain3d-proof/g60-rock-snow-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g60-rock-snow-imported-topdown.png"
const EXPECTED_SCHEMA := "westeros-g60-terrain3d-rock-snow-probe-v1"
const EXPECTED_POLICY := "safak-kartali-g60-terrain3d-rock-snow-2026-08-15-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const HEIGHT_TOLERANCE := 0.001
const MATERIAL_TOLERANCE := 0.006
const BLEND_TOLERANCE := 0.000001

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G60 Terrain3D Rock/Snow proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _source_value(probe: Dictionary, channel: int, u: float, v: float) -> float:
	var rows: Array = probe["rows"]
	var gx := clampf(u, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var gy := clampf(v, 0.0, 1.0) * float(SOURCE_SIZE - 1)
	var x0 := int(floor(gx)); var y0 := int(floor(gy))
	var x1 := mini(x0 + 1, SOURCE_SIZE - 1); var y1 := mini(y0 + 1, SOURCE_SIZE - 1)
	var tx := gx - float(x0); var ty := gy - float(y0)
	var a := float(rows[y0][x0][channel]); var b := float(rows[y0][x1][channel])
	var c := float(rows[y1][x0][channel]); var d := float(rows[y1][x1][channel])
	return lerpf(lerpf(a, b, tx), lerpf(c, d, tx), ty)

func _height_image(probe: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			image.set_pixel(x, z, Color(_source_value(probe, 3, float(x) / 256.0, float(z) / 256.0), 0, 0, 1))
	return image

func _control_image(probe: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	var base_id := int(probe["baseTextureId"])
	var overlay_id := int(probe["overlayTextureId"])
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var blend := int(round(clampf(_source_value(probe, 4, float(x) / 256.0, float(z) / 256.0), 0, 1) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(base_id) | Terrain3DUtil.enc_overlay(overlay_id) | Terrain3DUtil.enc_blend(blend)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0, 0, 1))
	return image

func _color_image(probe: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var u := float(x) / 256.0; var v := float(z) / 256.0
			image.set_pixel(x, z, Color(
				_source_value(probe, 5, u, v), _source_value(probe, 6, u, v),
				_source_value(probe, 7, u, v), _source_value(probe, 8, u, v)))
	return image

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null: return {"files": [], "totalBytes": 0}
	var files: Array[String] = []; var total_bytes := 0
	dir.list_dir_begin(); var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			var bytes := FileAccess.get_file_as_bytes(directory.path_join(name))
			if bytes.size() > 0:
				files.push_back(name); total_bytes += bytes.size()
		name = dir.get_next()
	dir.list_dir_end(); files.sort()
	return {"files": files, "totalBytes": total_bytes}

func _write_preview(terrain: Terrain3D) -> Error:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var pos := Vector3(float(x), 0, float(z))
			var color := terrain.data.get_color(pos)
			var roughness := terrain.data.get_roughness(pos)
			var blend := terrain.data.get_control_blend(pos)
			if is_nan(color.r) or is_nan(color.g) or is_nan(color.b) or is_nan(roughness) or is_nan(blend): return ERR_INVALID_DATA
			# Zero blend means the preview remains the qualified ocean-floor biome.
			image.set_pixel(x, z, Color(color.r, color.g, color.b, clampf(roughness, 0, 1)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	return image.save_png(PREVIEW_PATH)

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "probe JSON missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON invalid"): return
	var probe: Dictionary = parsed
	if not _require(String(probe.get("schema", "")) == EXPECTED_SCHEMA, "schema drifted"): return
	if not _require(String(probe.get("policyId", "")) == EXPECTED_POLICY, "policy drifted"): return
	if not _require(String(probe.get("sourceMapSha256", "")) == EXPECTED_MAP_SHA, "map.png provenance drifted"): return
	if not _require(String(probe.get("geoCell", "")) == "G60", "GeoCell drifted"): return
	if not _require(int(probe.get("sourceGridSize", 0)) == SOURCE_SIZE, "source must remain 65x65"): return
	if not _require(int(probe.get("terrain3dImportSize", 0)) == IMPORT_SIZE and int(probe.get("terrain3dRegionSize", 0)) == REGION_SIZE, "expected 257 import over region 256"): return
	if not _require(probe.has("rows") and probe["rows"] is Array and (probe["rows"] as Array).size() == SOURCE_SIZE, "invalid row channel"): return
	for row in probe["rows"]:
		if not _require(row is Array and (row as Array).size() == SOURCE_SIZE, "invalid probe row width"): return
		for sample in row:
			if not _require(sample is Array and (sample as Array).size() == 9, "invalid probe channel count"): return
			if not _require(absf(float(sample[0])) <= 0.00000001 and absf(float(sample[1])) <= 0.00000001, "source invented rock/snow over sea"): return
			if not _require(absf(float(sample[2])) <= 0.00000001 and absf(float(sample[4])) <= 0.00000001, "source invented terrestrial control"): return
			if not _require(absf(float(sample[3]) + 8.0) <= 0.00000001, "source changed qualified Relief height"): return

	var terrain := Terrain3D.new()
	terrain.name = "G60Terrain3DRockSnowProof"; get_root().add_child(terrain); terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return
	terrain.data.import_images([_height_image(probe), _control_image(probe), _color_image(probe)], Vector3.ZERO, 0.0, 1.0)
	var region_count := terrain.data.get_region_count()
	if not _require(region_count >= 4, "257x257 Height+Control+Color import did not create >=4 regions"): return

	var base_id := int(probe["baseTextureId"]); var overlay_id := int(probe["overlayTextureId"])
	var max_height_error := 0.0; var max_blend_error := 0.0; var max_actual_blend := 0.0
	var max_color_error := 0.0; var max_roughness_error := 0.0; var aligned_samples := 0
	for sy in SOURCE_SIZE:
		for sx in SOURCE_SIZE:
			var u := float(sx) / 64.0; var v := float(sy) / 64.0; var pos := Vector3(float(sx * 4), 0, float(sy * 4))
			var height := terrain.data.get_height(pos); var color := terrain.data.get_color(pos); var roughness := terrain.data.get_roughness(pos); var blend := terrain.data.get_control_blend(pos)
			if not _require(not is_nan(height) and not is_nan(color.r) and not is_nan(roughness) and not is_nan(blend), "Terrain3D returned invalid aligned data"): return
			if not _require(terrain.data.get_control_base_id(pos) == base_id and terrain.data.get_control_overlay_id(pos) == overlay_id, "control texture IDs changed"): return
			max_height_error = maxf(max_height_error, absf(height - _source_value(probe, 3, u, v)))
			max_blend_error = maxf(max_blend_error, absf(blend - _source_value(probe, 4, u, v))); max_actual_blend = maxf(max_actual_blend, absf(blend))
			max_color_error = maxf(max_color_error, maxf(absf(color.r - _source_value(probe, 5, u, v)), maxf(absf(color.g - _source_value(probe, 6, u, v)), absf(color.b - _source_value(probe, 7, u, v)))))
			max_roughness_error = maxf(max_roughness_error, absf(roughness - _source_value(probe, 8, u, v))); aligned_samples += 1
	if not _require(aligned_samples == 4225, "aligned sample count drifted"): return
	if not _require(max_height_error <= HEIGHT_TOLERANCE, "height round-trip exceeded tolerance"): return
	if not _require(max_blend_error <= BLEND_TOLERANCE and max_actual_blend <= BLEND_TOLERANCE, "terrestrial control leaked into sea"): return
	if not _require(max_color_error <= MATERIAL_TOLERANCE and max_roughness_error <= MATERIAL_TOLERANCE, "color/roughness round-trip exceeded tolerance"): return

	var seam_axis := [254.75, 255.0, 255.25, 255.5, 255.75, 256.0]
	var cross_axis := [32.25, 96.5, 160.75, 224.5, 256.0]
	var max_seam_height_error := 0.0; var max_seam_blend := 0.0; var max_seam_material_error := 0.0; var seam_samples := 0
	for edge in seam_axis:
		for cross in cross_axis:
			for raw_pos in [Vector3(float(edge), 0.0, float(cross)), Vector3(float(cross), 0.0, float(edge))]:
				var pos: Vector3 = raw_pos
				var u: float = pos.x / 256.0
				var v: float = pos.z / 256.0
				var height := terrain.data.get_height(pos); var color := terrain.data.get_color(pos); var roughness := terrain.data.get_roughness(pos); var blend := terrain.data.get_control_blend(pos)
				if not _require(not is_nan(height) and not is_nan(color.r) and not is_nan(roughness) and not is_nan(blend), "invalid 255/256 seam sample"): return
				max_seam_height_error = maxf(max_seam_height_error, absf(height - _source_value(probe, 3, u, v))); max_seam_blend = maxf(max_seam_blend, absf(blend))
				max_seam_material_error = maxf(max_seam_material_error, maxf(absf(color.r - _source_value(probe, 5, u, v)), maxf(absf(color.g - _source_value(probe, 6, u, v)), maxf(absf(color.b - _source_value(probe, 7, u, v)), absf(roughness - _source_value(probe, 8, u, v)))))); seam_samples += 1
	if not _require(seam_samples == 60, "seam matrix drifted"): return
	if not _require(max_seam_height_error <= HEIGHT_TOLERANCE and max_seam_blend <= BLEND_TOLERANCE and max_seam_material_error <= MATERIAL_TOLERANCE, "255/256 seam exceeded tolerance"): return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "LOD0 bake returned no surface"): return
	var vertices: PackedVector3Array = baked_mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "LOD0 bake returned no vertices"): return
	var suffix := OS.get_environment("G60_ROCK_SNOW_PROOF_SUFFIX"); if suffix.is_empty(): suffix = "default"
	var save_dir := "user://g60-terrain3d-rock-snow-" + suffix; DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir)); terrain.data.save_directory(save_dir)
	var saved := _saved_region_evidence(save_dir)
	if not _require(saved["files"].size() >= 4 and int(saved["totalBytes"]) > 0, "Terrain3D region persistence failed"): return
	if not _require(_write_preview(terrain) == OK, "failed to write imported top-down proof"): return

	var metrics := {
		"terrain3dVersion": String(terrain.version), "regionSize": int(terrain.region_size), "regionCount": region_count,
		"alignedSamples": aligned_samples, "seamSamples": seam_samples,
		"maxHeightError": snappedf(max_height_error, 0.00000001), "maxBlendError": snappedf(max_blend_error, 0.00000001), "maxActualBlend": snappedf(max_actual_blend, 0.00000001),
		"maxColorError": snappedf(max_color_error, 0.00000001), "maxRoughnessError": snappedf(max_roughness_error, 0.00000001),
		"maxSeamHeightError": snappedf(max_seam_height_error, 0.00000001), "maxSeamBlend": snappedf(max_seam_blend, 0.00000001), "maxSeamMaterialError": snappedf(max_seam_material_error, 0.00000001),
		"bakedSurfaces": baked_mesh.get_surface_count(), "bakedVertices": vertices.size(), "savedRegionFiles": saved["files"].size(), "savedRegionBytes": int(saved["totalBytes"]),
	}
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof")); var file := FileAccess.open(METRICS_PATH, FileAccess.WRITE)
	if not _require(file != null, "could not write metrics"): return
	file.store_string(JSON.stringify(metrics) + "\n"); file.close()
	print("G60_TERRAIN3D_ROCK_SNOW_METRICS=" + JSON.stringify(metrics)); print("NE_G60_TERRAIN3D_ROCK_SNOW_VALIDATION_OK"); quit(0)
