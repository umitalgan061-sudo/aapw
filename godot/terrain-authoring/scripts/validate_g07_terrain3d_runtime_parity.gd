extends SceneTree

const SOURCE_PATH := "res://.terrain3d-proof/g07-runtime-source.json"
const BAKE_PATH := "res://.terrain3d-proof/g07-runtime-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g07-runtime-imported-topdown.png"
const EXPECTED_SOURCE_SCHEMA := "westeros-g07-runtime-source-v2"
const EXPECTED_POLICY := "gunbatimi-ustasi-g07-terrain3d-runtime-bake-2026-08-13-v2"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const BAKE_SCHEMA := "westeros-g07-terrain3d-bake-v2"
const REGION_SIZE := 256
const IMPORT_SIZE := 257
const SOURCE_SIZE := 65
const SOURCE_VERTEX_STRIDE := 4
const MAX_HEIGHT_ERROR := 0.01
const MAX_MEAN_HEIGHT_ERROR := 0.0025
const MAX_BLEND_ERROR := 0.006
const MAX_COLOR_ERROR := 0.006
const MAX_ROUGHNESS_ERROR := 0.006

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G07 Terrain3D runtime parity failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _finite(value: float) -> bool:
	return not is_nan(value) and not is_inf(value)

func _max3(a: float, b: float, c: float) -> float:
	return maxf(a, maxf(b, c))

func _source_value(source: Dictionary, u: float, v: float, column: int) -> float:
	var rows: Array = source["rows"]
	var size := int(source["sourceGridSize"])
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
	var top := lerpf(float(a[column]), float(b[column]), tx)
	var bottom := lerpf(float(c[column]), float(d[column]), tx)
	return lerpf(top, bottom, ty)

func _source_color(source: Dictionary, u: float, v: float) -> Color:
	return Color(
		clampf(_source_value(source, u, v, 5), 0.0, 1.0),
		clampf(_source_value(source, u, v, 6), 0.0, 1.0),
		clampf(_source_value(source, u, v, 7), 0.0, 1.0),
		clampf(_source_value(source, u, v, 8), 0.0, 1.0)
	)

func _build_height_image(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		var v := float(z) / float(IMPORT_SIZE - 1)
		for x in IMPORT_SIZE:
			var u := float(x) / float(IMPORT_SIZE - 1)
			image.set_pixel(x, z, Color(_source_value(source, u, v, 0), 0.0, 0.0, 1.0))
	return image

func _build_control_image(source: Dictionary) -> Image:
	var base_id := int(source["substrateTextureId"])
	var rock_id := int(source["rockTextureId"])
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		var v := float(z) / float(IMPORT_SIZE - 1)
		for x in IMPORT_SIZE:
			var u := float(x) / float(IMPORT_SIZE - 1)
			var blend_u8 := int(round(clampf(_source_value(source, u, v, 1), 0.0, 1.0) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(base_id) | Terrain3DUtil.enc_overlay(rock_id) | Terrain3DUtil.enc_blend(blend_u8)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0.0, 0.0, 1.0))
	return image

func _build_color_image(source: Dictionary) -> Image:
	var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		var v := float(z) / float(IMPORT_SIZE - 1)
		for x in IMPORT_SIZE:
			var u := float(x) / float(IMPORT_SIZE - 1)
			image.set_pixel(x, z, _source_color(source, u, v))
	return image

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null:
		return {"files": 0, "bytes": 0}
	var files := 0
	var bytes := 0
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			files += 1
			bytes += FileAccess.get_file_as_bytes(directory.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end()
	return {"files": files, "bytes": bytes}

func _write_preview(terrain: Terrain3D) -> bool:
	var preview := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RGBA8)
	var rock_color := Color(0.28, 0.31, 0.32, 1.0)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var pos := Vector3(float(x), 0.0, float(z))
			var tint := terrain.data.get_color(pos)
			var roughness := terrain.data.get_roughness(pos)
			var blend := terrain.data.get_control_blend(pos)
			if not _finite(tint.r) or not _finite(tint.g) or not _finite(tint.b) or not _finite(roughness) or not _finite(blend):
				return false
			var visible := Color(tint.r, tint.g, tint.b, 1.0).lerp(rock_color, clampf(blend, 0.0, 1.0) * 0.55)
			preview.set_pixel(x, z, Color(visible.r, visible.g, visible.b, clampf(roughness, 0.0, 1.0)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(PREVIEW_PATH).get_base_dir())
	return preview.save_png(PREVIEW_PATH) == OK

func _run() -> void:
	print("G07_TERRAIN3D_STAGE=source")
	if not _require(FileAccess.file_exists(SOURCE_PATH), "source probe missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(SOURCE_PATH))
	if not _require(parsed is Dictionary, "source probe invalid"): return
	var source: Dictionary = parsed
	if not _require(String(source.get("schema", "")) == EXPECTED_SOURCE_SCHEMA, "source schema mismatch"): return
	if not _require(String(source.get("policyId", "")) == EXPECTED_POLICY, "source policy mismatch"): return
	if not _require(String(source.get("sourceMapSha256", "")) == EXPECTED_SOURCE_SHA, "map.png source SHA mismatch"): return
	if not _require(int(source.get("sourceGridSize", 0)) == SOURCE_SIZE, "source grid must be 65x65"): return
	if not _require(int(source.get("terrain3dImportSize", 0)) == IMPORT_SIZE, "Terrain3D import must be 257x257"): return
	if not _require(int(source.get("sourceVertexStride", 0)) == SOURCE_VERTEX_STRIDE, "source stride must be 4"): return
	var rows: Array = source["rows"]
	if not _require(rows.size() == SOURCE_SIZE, "source row count mismatch"): return
	for y in SOURCE_SIZE:
		var row: Array = rows[y]
		if not _require(row.size() == SOURCE_SIZE, "source column count mismatch at row %d" % y): return
		for x in SOURCE_SIZE:
			var sample: Array = row[x]
			if not _require(sample.size() >= 10, "source sample width mismatch"): return
			if not _require(_finite(float(sample[0])), "non-finite source height"): return
			if not _require(float(sample[0]) <= float(source["waterCeilingMeters"]), "G07 source invented above-water terrain"): return
			if not _require(absf(float(sample[2])) <= 0.00000001, "G07 source invented snow"): return
			if not _require(absf(float(sample[3])) <= 0.00000001, "G07 source invented road"): return
			if not _require(absf(float(sample[4])) <= 0.00000001, "G07 source invented path"): return

	print("G07_TERRAIN3D_STAGE=import")
	var terrain := Terrain3D.new()
	terrain.name = "G07Terrain3DRuntimeParity"
	get_root().add_child(terrain)
	terrain.region_size = REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D 1.0.2 not loaded"): return
	terrain.data.import_images([_build_height_image(source), _build_control_image(source), _build_color_image(source)], Vector3.ZERO, 0.0, 1.0)
	var region_count := terrain.data.get_region_count()
	if not _require(region_count >= 4, "257x257 height/control/color import did not create four guard-backed regions"): return

	print("G07_TERRAIN3D_STAGE=roundtrip")
	var base_id := int(source["substrateTextureId"])
	var rock_id := int(source["rockTextureId"])
	var out_heights: Array = []
	var out_rock: Array = []
	var out_color_roughness: Array = []
	var max_height_error := 0.0
	var sum_height_error := 0.0
	var max_blend_error := 0.0
	var max_color_error := 0.0
	var max_roughness_error := 0.0
	var control_checksum: int = 2166136261
	var color_checksum: int = 2166136261
	for y in SOURCE_SIZE:
		for x in SOURCE_SIZE:
			var px := float(x * SOURCE_VERTEX_STRIDE)
			var pz := float(y * SOURCE_VERTEX_STRIDE)
			var pos := Vector3(px, 0.0, pz)
			var expected: Array = rows[y][x]
			var actual_height := terrain.data.get_height(pos)
			if not _require(_finite(actual_height), "non-finite aligned height at source=(%d,%d)" % [x, y]): return
			var height_error := absf(actual_height - float(expected[0]))
			max_height_error = maxf(max_height_error, height_error)
			sum_height_error += height_error
			if not _require(terrain.data.get_control_base_id(pos) == base_id, "base texture ID changed"): return
			if not _require(terrain.data.get_control_overlay_id(pos) == rock_id, "rock overlay ID changed"): return
			var actual_blend := terrain.data.get_control_blend(pos)
			if not _require(_finite(actual_blend), "non-finite aligned rock blend"): return
			max_blend_error = maxf(max_blend_error, absf(actual_blend - float(expected[1])))
			var actual_color := terrain.data.get_color(pos)
			var actual_roughness := terrain.data.get_roughness(pos)
			if not _require(_finite(actual_color.r) and _finite(actual_color.g) and _finite(actual_color.b) and _finite(actual_roughness), "non-finite aligned color/roughness"): return
			max_color_error = maxf(max_color_error, _max3(absf(actual_color.r - float(expected[5])), absf(actual_color.g - float(expected[6])), absf(actual_color.b - float(expected[7]))))
			max_roughness_error = maxf(max_roughness_error, absf(actual_roughness - float(expected[8])))
			out_heights.push_back(actual_height)
			out_rock.push_back(actual_blend)
			out_color_roughness.push_back([actual_color.r, actual_color.g, actual_color.b, actual_roughness])
			control_checksum = int((control_checksum ^ int(round(clampf(actual_blend, 0.0, 1.0) * 255.0))) * 16777619) & 0xffffffff
			for component in [actual_color.r, actual_color.g, actual_color.b, actual_roughness]:
				color_checksum = int((color_checksum ^ int(round(clampf(component, 0.0, 1.0) * 255.0))) * 16777619) & 0xffffffff
	var mean_height_error := sum_height_error / float(SOURCE_SIZE * SOURCE_SIZE)
	if not _require(max_height_error <= MAX_HEIGHT_ERROR, "height roundtrip exceeded 0.01 m"): return
	if not _require(mean_height_error <= MAX_MEAN_HEIGHT_ERROR, "mean height roundtrip exceeded 0.0025 m"): return
	if not _require(max_blend_error <= MAX_BLEND_ERROR, "rock control roundtrip exceeded tolerance"): return
	if not _require(max_color_error <= MAX_COLOR_ERROR, "marine color roundtrip exceeded tolerance"): return
	if not _require(max_roughness_error <= MAX_ROUGHNESS_ERROR, "near-detail roughness roundtrip exceeded tolerance"): return

	print("G07_TERRAIN3D_STAGE=continuous")
	var max_fractional_height_error := 0.0
	for y in SOURCE_SIZE - 1:
		for x in SOURCE_SIZE - 1:
			var px := float(x * SOURCE_VERTEX_STRIDE) + 3.5
			var pz := float(y * SOURCE_VERTEX_STRIDE) + 3.5
			var actual := terrain.data.get_height(Vector3(px, 0.0, pz))
			if not _require(_finite(actual), "fractional height probe non-finite at terrain=(%.1f,%.1f)" % [px, pz]): return
			var expected := _source_value(source, px / float(IMPORT_SIZE - 1), pz / float(IMPORT_SIZE - 1), 0)
			max_fractional_height_error = maxf(max_fractional_height_error, absf(actual - expected))
	if not _require(max_fractional_height_error <= MAX_HEIGHT_ERROR, "fractional cross-region height continuity exceeded 0.01 m"): return

	var max_boundary_height_step := 0.0
	var max_boundary_blend_step := 0.0
	var max_boundary_color_step := 0.0
	var max_boundary_roughness_step := 0.0
	for coordinate in range(0, IMPORT_SIZE, 8):
		var a := Vector3(255.0, 0.0, float(coordinate))
		var b := Vector3(256.0, 0.0, float(coordinate))
		var ah := terrain.data.get_height(a); var bh := terrain.data.get_height(b)
		var ab := terrain.data.get_control_blend(a); var bb := terrain.data.get_control_blend(b)
		var ac := terrain.data.get_color(a); var bc := terrain.data.get_color(b)
		var ar := terrain.data.get_roughness(a); var br := terrain.data.get_roughness(b)
		if not _require(_finite(ah) and _finite(bh) and _finite(ab) and _finite(bb) and _finite(ac.r) and _finite(bc.r) and _finite(ar) and _finite(br), "255/256 guard boundary returned non-finite data"): return
		max_boundary_height_step = maxf(max_boundary_height_step, absf(ah - bh))
		max_boundary_blend_step = maxf(max_boundary_blend_step, absf(ab - bb))
		max_boundary_color_step = maxf(max_boundary_color_step, _max3(absf(ac.r - bc.r), absf(ac.g - bc.g), absf(ac.b - bc.b)))
		max_boundary_roughness_step = maxf(max_boundary_roughness_step, absf(ar - br))

	print("G07_TERRAIN3D_STAGE=bake")
	var mesh: Mesh = terrain.bake_mesh(0)
	if not _require(mesh != null and mesh.get_surface_count() >= 1, "LOD0 bake produced no surface"): return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(not vertices.is_empty(), "LOD0 bake produced no vertices"): return
	for i in vertices.size():
		var vertex := vertices[i]
		if not _require(_finite(vertex.x) and _finite(vertex.y) and _finite(vertex.z), "LOD0 bake produced non-finite vertex at index %d" % i): return

	print("G07_TERRAIN3D_STAGE=persist")
	var suffix := OS.get_environment("G07_PARITY_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var save_dir := "user://g07-runtime-parity-regions-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir))
	terrain.data.save_directory(save_dir)
	var saved := _saved_region_evidence(save_dir)
	if not _require(int(saved["files"]) >= 4 and int(saved["bytes"]) > 0, "guard region persistence produced fewer than four non-empty resources"): return
	if not _require(_write_preview(terrain), "imported top-down preview contains non-finite Terrain3D data"): return

	var bake := {
		"schema": BAKE_SCHEMA,
		"sourceSchema": EXPECTED_SOURCE_SCHEMA,
		"policyId": EXPECTED_POLICY,
		"width": SOURCE_SIZE,
		"height": SOURCE_SIZE,
		"normalizedBounds": source["normalizedBounds"],
		"sourceMapSha256": EXPECTED_SOURCE_SHA,
		"heights": out_heights,
		"rockBlend": out_rock,
		"colorRoughness": out_color_roughness,
		"substrateTextureId": base_id,
		"rockTextureId": rock_id,
		"snowBlend": 0.0,
		"roadBlend": 0.0,
		"pathBlend": 0.0,
		"terrain3dVersion": String(terrain.version),
		"regionSize": REGION_SIZE,
		"importWidth": IMPORT_SIZE,
		"importHeight": IMPORT_SIZE,
		"sourceVertexStride": SOURCE_VERTEX_STRIDE,
		"regionCount": region_count,
		"boundarySampling": "257x257 height/control/color guard-backed import; 65 source nodes every four vertices; fractional height probes cross 255/256",
		"bakedSurfaces": mesh.get_surface_count(),
		"bakedVertices": vertices.size(),
		"savedRegionFiles": int(saved["files"]),
		"regionPersistenceNonEmpty": true,
		"maxHeightError": max_height_error,
		"meanHeightError": mean_height_error,
		"maxRockBlendError": max_blend_error,
		"maxColorError": max_color_error,
		"maxRoughnessError": max_roughness_error,
		"maxFractionalHeightError": max_fractional_height_error,
		"maxBoundaryHeightStep": max_boundary_height_step,
		"maxBoundaryRockStep": max_boundary_blend_step,
		"maxBoundaryColorStep": max_boundary_color_step,
		"maxBoundaryRoughnessStep": max_boundary_roughness_step,
		"controlChecksum": control_checksum,
		"colorRoughnessChecksum": color_checksum,
		"previewPath": PREVIEW_PATH
	}
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	var file := FileAccess.open(BAKE_PATH, FileAccess.WRITE)
	if not _require(file != null, "could not open bake output"): return
	file.store_string(JSON.stringify(bake)); file.close()
	var metrics := bake.duplicate()
	metrics["heights"] = []
	metrics["rockBlend"] = []
	metrics["colorRoughness"] = []
	metrics["savedRegionBytesObserved"] = int(saved["bytes"])
	print("G07_TERRAIN3D_RUNTIME_BAKE_METRICS=" + JSON.stringify(metrics))
	print("SW_G07_TERRAIN3D_RUNTIME_BAKE_OK")
	quit(0)
