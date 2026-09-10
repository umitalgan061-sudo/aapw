extends SceneTree

const PROBE := "res://.terrain3d-proof/g17-road-path-probe.json"
const PREVIEW := "res://.terrain3d-proof/g17-road-path-imported-topdown.png"
const N := 257
const REGION := 256
const MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const POLICY := "gunbatimi-ustasi-g17-terrain3d-road-path-2026-08-14-v2"
const MAX_HEIGHT_ERROR := 0.012
const MAX_BLEND_ERROR := 0.006
const MAX_COLOR_ERROR := 0.006

func _initialize() -> void:
	call_deferred("_run")

func fail(message: String) -> void:
	push_error("G17 Terrain3D Road/Path proof failed: " + message)
	quit(1)

func need(ok: bool, message: String) -> bool:
	if not ok:
		fail(message)
		return false
	return true

func control_float(base_id: int, overlay_id: int, blend_u8: int) -> float:
	var bits: int = Terrain3DUtil.enc_base(base_id) | Terrain3DUtil.enc_overlay(overlay_id) | Terrain3DUtil.enc_blend(blend_u8)
	return Terrain3DUtil.as_float(bits)

func images(p: Dictionary) -> Array:
	var height := Image.create_empty(N, N, false, Image.FORMAT_RF)
	var control := Image.create_empty(N, N, false, Image.FORMAT_RF)
	var color := Image.create_empty(N, N, false, Image.FORMAT_RGBA8)
	var rows: Array = p["rows"]
	var colors: Array = p["colors"]
	for z in N:
		for x in N:
			var sample: Array = rows[z][x]
			var tint: Array = colors[z][x]
			height.set_pixel(x, z, Color(float(sample[3]), 0.0, 0.0, 1.0))
			control.set_pixel(x, z, Color(control_float(int(sample[0]), int(sample[1]), int(sample[2])), 0.0, 0.0, 1.0))
			color.set_pixel(x, z, Color(float(tint[0]), float(tint[1]), float(tint[2]), float(tint[3])))
	return [height, control, color]

func saved_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null:
		return {}
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

func sample_proof(terrain: Variant, p: Dictionary) -> Dictionary:
	var rows: Array = p["rows"]
	var colors: Array = p["colors"]
	var max_height := 0.0
	var max_blend := 0.0
	var max_color := 0.0
	var max_roughness := 0.0
	var count := 0
	var phantom := 0
	var checksum: int = 2166136261
	for sz in 65:
		for sx in 65:
			var x := sx * 4
			var z := sz * 4
			var source: Array = rows[z][x]
			var tint: Array = colors[z][x]
			var pos := Vector3(float(x), 0.0, float(z))
			var actual_height: float = float(terrain.data.get_height(pos))
			var actual_blend: float = float(terrain.data.get_control_blend(pos))
			var actual_color: Color = terrain.data.get_color(pos)
			var actual_roughness: float = float(terrain.data.get_roughness(pos))
			var overlay: int = int(terrain.data.get_control_overlay_id(pos))
			if is_nan(actual_height) or is_nan(actual_blend) or is_nan(actual_roughness):
				return {}
			if terrain.data.get_control_base_id(pos) != int(source[0]) or overlay != int(source[1]):
				return {}
			if overlay == int(p["roadTextureId"]) or overlay == int(p["pathTextureId"]):
				phantom += 1
			max_height = maxf(max_height, absf(actual_height - float(source[3])))
			max_blend = maxf(max_blend, absf(actual_blend - float(source[2]) / 255.0))
			max_color = maxf(max_color, maxf(absf(actual_color.r - float(tint[0])), maxf(absf(actual_color.g - float(tint[1])), absf(actual_color.b - float(tint[2])))))
			max_roughness = maxf(max_roughness, absf(actual_roughness - float(tint[3])))
			checksum = int((checksum ^ int(round((actual_height + 32.0) * 1000.0))) * 16777619) & 0xffffffff
			checksum = int((checksum ^ int(round(actual_blend * 255.0))) * 16777619) & 0xffffffff
			count += 1
	return {"count": count, "height": max_height, "blend": max_blend, "color": max_color, "roughness": max_roughness, "phantom": phantom, "checksum": checksum}

func seam_proof(terrain: Variant, p: Dictionary) -> Dictionary:
	var rows: Array = p["rows"]
	var colors: Array = p["colors"]
	var max_height := 0.0
	var max_blend := 0.0
	var max_color := 0.0
	var max_roughness := 0.0
	var count := 0
	for edge in [255, 256]:
		for other in range(0, 257, 16):
			for q in [Vector2(edge, other), Vector2(other, edge)]:
				var x := int(q.x)
				var z := int(q.y)
				var source: Array = rows[z][x]
				var tint: Array = colors[z][x]
				var pos := Vector3(q.x, 0.0, q.y)
				var actual_height: float = float(terrain.data.get_height(pos))
				var actual_blend: float = float(terrain.data.get_control_blend(pos))
				var actual_color: Color = terrain.data.get_color(pos)
				var actual_roughness: float = float(terrain.data.get_roughness(pos))
				var overlay: int = int(terrain.data.get_control_overlay_id(pos))
				if is_nan(actual_height) or is_nan(actual_blend) or is_nan(actual_roughness): return {}
				if terrain.data.get_control_base_id(pos) != int(source[0]) or overlay != int(source[1]): return {}
				if overlay == int(p["roadTextureId"]) or overlay == int(p["pathTextureId"]): return {}
				max_height = maxf(max_height, absf(actual_height - float(source[3])))
				max_blend = maxf(max_blend, absf(actual_blend - float(source[2]) / 255.0))
				max_color = maxf(max_color, maxf(absf(actual_color.r - float(tint[0])), maxf(absf(actual_color.g - float(tint[1])), absf(actual_color.b - float(tint[2])))))
				max_roughness = maxf(max_roughness, absf(actual_roughness - float(tint[3])))
				count += 1
	return {"count": count, "height": max_height, "blend": max_blend, "color": max_color, "roughness": max_roughness}

func write_preview(terrain: Variant, p: Dictionary) -> bool:
	var image := Image.create_empty(256, 256, false, Image.FORMAT_RGB8)
	for z in 256:
		for x in 256:
			var pos := Vector3(float(x), 0.0, float(z))
			var overlay: int = int(terrain.data.get_control_overlay_id(pos))
			if overlay == int(p["roadTextureId"]) or overlay == int(p["pathTextureId"]):
				image.set_pixel(x, z, Color(1.0, 0.0, 0.0))
				continue
			var color: Color = terrain.data.get_color(pos)
			var blend: float = float(terrain.data.get_control_blend(pos))
			image.set_pixel(x, z, color.darkened(0.12 * clampf(blend, 0.0, 1.0)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(PREVIEW).get_base_dir())
	return image.save_png(PREVIEW) == OK

func _run() -> void:
	if not need(FileAccess.file_exists(PROBE), "probe missing"): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE))
	if not need(parsed is Dictionary, "probe invalid"): return
	var p: Dictionary = parsed
	if not need(String(p["policyId"]) == POLICY, "policy changed"): return
	if not need(String(p["sourceMapSha256"]) == MAP_SHA, "map SHA changed"): return
	if not need(int(p["regionSize"]) == REGION and int(p["importSize"]) == N and int(p["samples"]) == 66049, "probe dimensions changed"): return
	if not need(int(p["roadTextureId"]) == 2 and int(p["pathTextureId"]) == 3, "road/path texture IDs changed"): return
	var route: Dictionary = p["routeEvidence"]
	if not need(int(route["roadOwnedCrossingSegments"]) == 0 and int(route["roadGuardCrossingSegments"]) == 0 and int(route["pathOwnedCrossingSegments"]) == 0 and int(route["pathGuardCrossingSegments"]) == 0, "live route entered G17"): return
	if not need(ClassDB.class_exists("Terrain3D"), "Terrain3D class not registered"): return
	var terrain: Variant = ClassDB.instantiate("Terrain3D")
	if not need(terrain != null, "Terrain3D instantiate failed"): return
	get_root().add_child(terrain)
	terrain.region_size = REGION
	if not need(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D did not load"): return
	terrain.data.import_images(images(p), Vector3.ZERO, 0.0, 1.0)
	if not need(terrain.data.get_region_count() >= 4, "257 import must create >=4 regions"): return
	var aligned := sample_proof(terrain, p)
	if not need(not aligned.is_empty() and int(aligned["count"]) == 4225 and int(aligned["phantom"]) == 0, "aligned proof/phantom-road gate failed"): return
	if not need(float(aligned["height"]) <= MAX_HEIGHT_ERROR and float(aligned["blend"]) <= MAX_BLEND_ERROR and float(aligned["color"]) <= MAX_COLOR_ERROR and float(aligned["roughness"]) <= MAX_COLOR_ERROR, "aligned Terrain3D roundtrip exceeded tolerance"): return
	var seam := seam_proof(terrain, p)
	if not need(not seam.is_empty() and int(seam["count"]) == 68, "255/256 seam coverage failed"): return
	if not need(float(seam["height"]) <= MAX_HEIGHT_ERROR and float(seam["blend"]) <= MAX_BLEND_ERROR and float(seam["color"]) <= MAX_COLOR_ERROR and float(seam["roughness"]) <= MAX_COLOR_ERROR, "255/256 seam roundtrip exceeded tolerance"): return
	var mesh: Mesh = terrain.bake_mesh(0)
	if not need(mesh != null and mesh.get_surface_count() > 0, "LOD0 bake empty"): return
	var vertices: PackedVector3Array = mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not need(vertices.size() > 0, "LOD0 vertices empty"): return
	var suffix := OS.get_environment("G17_ROAD_PATH_PROOF_SUFFIX")
	if suffix.is_empty(): suffix = "default"
	var out := "user://g17-road-path-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(out))
	terrain.data.save_directory(out)
	var saved := saved_evidence(out)
	if not need(int(saved["files"]) >= 4 and int(saved["bytes"]) > 0, "region persistence failed"): return
	var reload: Variant = ClassDB.instantiate("Terrain3D")
	if not need(reload != null, "Terrain3D reload instantiate failed"): return
	get_root().add_child(reload)
	reload.region_size = REGION
	reload.data.load_directory(out)
	if not need(reload.data.get_region_count() >= 4, "reload regions missing"): return
	var reloaded := sample_proof(reload, p)
	if not need(not reloaded.is_empty() and int(reloaded["count"]) == 4225 and int(reloaded["phantom"]) == 0 and int(reloaded["checksum"]) == int(aligned["checksum"]), "save/reload parity failed"): return
	if not need(write_preview(reload, p), "imported top-down preview failed"): return
	var metrics = {
		"terrain3dVersion": String(terrain.version), "regionSize": REGION, "regions": terrain.data.get_region_count(),
		"samples": aligned["count"], "seamSamples": seam["count"], "phantomRoadPathSamples": aligned["phantom"],
		"maxHeightError": snappedf(aligned["height"], 0.00000001), "maxBlendError": snappedf(aligned["blend"], 0.00000001),
		"maxColorError": snappedf(aligned["color"], 0.00000001), "maxRoughnessError": snappedf(aligned["roughness"], 0.00000001),
		"maxSeamHeightError": snappedf(seam["height"], 0.00000001), "maxSeamBlendError": snappedf(seam["blend"], 0.00000001),
		"maxSeamColorError": snappedf(seam["color"], 0.00000001), "maxSeamRoughnessError": snappedf(seam["roughness"], 0.00000001),
		"checksum": aligned["checksum"], "bakedSurfaces": mesh.get_surface_count(), "bakedVertices": vertices.size(),
		"savedRegionFiles": saved["files"], "savedRegionBytes": saved["bytes"], "roadGuardCrossings": route["roadGuardCrossingSegments"], "pathGuardCrossings": route["pathGuardCrossingSegments"]
	}
	print("G17_TERRAIN3D_ROAD_PATH_METRICS=" + JSON.stringify(metrics))
	print("SW_G17_TERRAIN3D_ROAD_PATH_VALIDATION_OK")
	quit(0)
