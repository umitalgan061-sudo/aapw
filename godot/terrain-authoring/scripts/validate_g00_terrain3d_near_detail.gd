extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g00-near-detail-probe.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g00-near-detail-imported-topdown.png"
const EXPECTED_POLICY := "buzul-muhafizi-g00-terrain3d-near-detail-2026-08-13-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const MAX_HEIGHT_ERROR := 0.00003
const MAX_BLEND_ERROR := 0.007
const MAX_COLOR_ERROR := 0.006
const MAX_ROUGHNESS_ERROR := 0.006
const ROAD_ACTIVE_EPS := 0.002

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G00 Terrain3D near-detail proof failed: " + message)
	quit(1)

func _require(condition: bool, message: String) -> bool:
	if not condition:
		_fail(message)
		return false
	return true

func _mesh_asset(asset_name: String, color: Color, size: Vector2) -> Terrain3DMeshAsset:
	var asset := Terrain3DMeshAsset.new()
	asset.name = asset_name
	asset.generated_type = Terrain3DMeshAsset.TYPE_TEXTURE_CARD
	asset.generated_faces = 2
	asset.generated_size = size
	asset.material_override.albedo_color = color
	return asset

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

func _source_kind(probe: Dictionary, u: float, v: float) -> int:
	var rows: Array = probe["rows"]
	var size := int(probe["sourceGridSize"])
	var x := clampi(int(round(clampf(u, 0.0, 1.0) * float(size - 1))), 0, size - 1)
	var y := clampi(int(round(clampf(v, 0.0, 1.0) * float(size - 1))), 0, size - 1)
	return int(rows[y][x][2])

func _source_height(probe: Dictionary, u: float, v: float) -> float:
	return _source_component(probe, u, v, 3)

func _source_color(probe: Dictionary, u: float, v: float) -> Color:
	return Color(
		clampf(_source_component(probe, u, v, 7), 0.0, 1.0),
		clampf(_source_component(probe, u, v, 8), 0.0, 1.0),
		clampf(_source_component(probe, u, v, 9), 0.0, 1.0),
		clampf(_source_component(probe, u, v, 10), 0.0, 1.0)
	)

func _expected_control(probe: Dictionary, u: float, v: float) -> Dictionary:
	var road := clampf(_source_component(probe, u, v, 0), 0.0, 1.0)
	var path := clampf(_source_component(probe, u, v, 1), 0.0, 1.0)
	var coverage := maxf(road, path)
	var rock_id := int(probe["rockTextureId"])
	var snow_id := int(probe["snowTextureId"])
	if coverage > ROAD_ACTIVE_EPS:
		var substrate_snow := clampf(_source_component(probe, u, v, 5), 0.0, 1.0)
		var kind := _source_kind(probe, u, v)
		return {
			"base": snow_id if substrate_snow >= 0.5 else rock_id,
			"overlay": int(probe["pathTextureId"]) if kind == 2 else int(probe["roadTextureId"]),
			"blend": coverage,
			"isRoadPath": true,
		}
	return {
		"base": rock_id,
		"overlay": snow_id,
		"blend": clampf(_source_component(probe, u, v, 4), 0.0, 1.0),
		"isRoadPath": false,
	}

func _build_height_image(probe: Dictionary) -> Image:
	var region_size := int(probe["terrain3dRegionSize"])
	var image := Image.create_empty(region_size, region_size, false, Image.FORMAT_RF)
	for z in region_size:
		var v := float(z) / float(region_size - 1)
		for x in region_size:
			var u := float(x) / float(region_size - 1)
			image.set_pixel(x, z, Color(_source_height(probe, u, v), 0.0, 0.0, 1.0))
	return image

func _build_control_image(probe: Dictionary) -> Image:
	var region_size := int(probe["terrain3dRegionSize"])
	var image := Image.create_empty(region_size, region_size, false, Image.FORMAT_RF)
	for z in region_size:
		var v := float(z) / float(region_size - 1)
		for x in region_size:
			var u := float(x) / float(region_size - 1)
			var expected := _expected_control(probe, u, v)
			var blend_u8 := int(round(clampf(float(expected["blend"]), 0.0, 1.0) * 255.0))
			var bits: int = Terrain3DUtil.enc_base(int(expected["base"])) | Terrain3DUtil.enc_overlay(int(expected["overlay"])) | Terrain3DUtil.enc_blend(blend_u8)
			image.set_pixel(x, z, Color(Terrain3DUtil.as_float(bits), 0.0, 0.0, 1.0))
	return image

func _build_color_image(probe: Dictionary) -> Image:
	var region_size := int(probe["terrain3dRegionSize"])
	var image := Image.create_empty(region_size, region_size, false, Image.FORMAT_RGBA8)
	for z in region_size:
		var v := float(z) / float(region_size - 1)
		for x in region_size:
			var u := float(x) / float(region_size - 1)
			image.set_pixel(x, z, _source_color(probe, u, v))
	return image

func _instance_transform(instance: Dictionary, terrain: Terrain3D) -> Transform3D:
	var x := clampf(float(instance["localX"]), 0.0, 255.0)
	var z := clampf(float(instance["localZ"]), 0.0, 255.0)
	var position := Vector3(x, 0.0, z)
	position.y = terrain.data.get_height(position)
	var yaw := float(instance["yaw"])
	var scale := float(instance["scale"])
	var basis := Basis(Vector3.UP, yaw).scaled(Vector3.ONE * scale)
	return Transform3D(basis, position)

func _count_region_instances(region: Terrain3DRegion) -> Dictionary:
	var counts := {0: 0, 1: 0}
	var instances: Dictionary = region.instances
	for mesh_id_variant in instances.keys():
		var mesh_id := int(mesh_id_variant)
		var cells: Dictionary = instances[mesh_id_variant]
		for cell_key in cells.keys():
			var payload: Array = cells[cell_key]
			var transforms: Array = payload[0]
			counts[mesh_id] = int(counts.get(mesh_id, 0)) + transforms.size()
	return counts

func _stored_instance_checksum(region: Terrain3DRegion) -> int:
	var checksum: int = 2166136261
	var instances: Dictionary = region.instances
	var mesh_ids: Array = instances.keys()
	mesh_ids.sort()
	for mesh_id_variant in mesh_ids:
		var mesh_id := int(mesh_id_variant)
		var cells: Dictionary = instances[mesh_id_variant]
		var cell_keys: Array = cells.keys()
		cell_keys.sort_custom(func(a, b): return str(a) < str(b))
		for cell_key in cell_keys:
			var payload: Array = cells[cell_key]
			var transforms: Array = payload[0]
			for transform_variant in transforms:
				var transform: Transform3D = transform_variant
				for value in [transform.origin.x, transform.origin.y, transform.origin.z, transform.basis.get_scale().x]:
					var q := int(round(float(value) * 1000.0))
					for shift in [0, 8, 16, 24]:
						checksum = int((checksum ^ ((q >> shift) & 0xff)) * 16777619) & 0xffffffff
			checksum = int((checksum ^ (mesh_id & 0xff)) * 16777619) & 0xffffffff
	return checksum

func _write_imported_preview(terrain: Terrain3D, region: Terrain3DRegion) -> Error:
	var image := Image.create_empty(256, 256, false, Image.FORMAT_RGBA8)
	for z in 256:
		for x in 256:
			var pos := Vector3(float(x), 0.0, float(z))
			var tint := terrain.data.get_color(pos)
			var roughness := terrain.data.get_roughness(pos)
			if is_nan(tint.r) or is_nan(roughness):
				image.set_pixel(x, z, Color(1.0, 0.0, 1.0, 1.0))
			else:
				image.set_pixel(x, z, Color(tint.r, tint.g, tint.b, clampf(roughness, 0.0, 1.0)))
	var instances: Dictionary = region.instances
	for mesh_id_variant in instances.keys():
		var mesh_id := int(mesh_id_variant)
		var dot := Color(0.18, 0.42, 0.16, 1.0) if mesh_id == 0 else Color(0.38, 0.62, 0.24, 1.0)
		var cells: Dictionary = instances[mesh_id_variant]
		for cell_key in cells.keys():
			var payload: Array = cells[cell_key]
			for transform_variant in payload[0]:
				var transform: Transform3D = transform_variant
				var px := clampi(int(round(transform.origin.x)), 0, 255)
				var py := clampi(int(round(transform.origin.z)), 0, 255)
				for oy in range(-2, 3):
					for ox in range(-2, 3):
						if ox * ox + oy * oy > 4:
							continue
						var ix := px + ox
						var iy := py + oy
						if ix >= 0 and ix < 256 and iy >= 0 and iy < 256:
							image.set_pixel(ix, iy, dot)
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	return image.save_png(PREVIEW_PATH)

func _saved_region_evidence(directory: String) -> Dictionary:
	var dir := DirAccess.open(directory)
	if dir == null:
		_fail("Terrain3D near-detail save directory was not created")
		return {}
	var count := 0
	var total_bytes := 0
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if not dir.current_is_dir():
			count += 1
			total_bytes += FileAccess.get_file_as_bytes(directory.path_join(name)).size()
		name = dir.get_next()
	dir.list_dir_end()
	return {"count": count, "totalBytes": total_bytes}

func _run() -> void:
	if not _require(FileAccess.file_exists(PROBE_PATH), "G00 near-detail probe JSON missing"):
		return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON did not decode to Dictionary"):
		return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected G00 near-detail policy"):
		return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "owner-map SHA changed"):
		return
	if not _require(int(probe["sourceGridSize"]) == 257, "proof must use 257x257 source field to preserve Road/Path"):
		return
	if not _require(int(probe["terrain3dRegionSize"]) == 256, "proof must use Terrain3D region size 256"):
		return

	var rock_id := int(probe["rockTextureId"])
	var snow_id := int(probe["snowTextureId"])
	if not _require(rock_id != snow_id and int(probe["roadTextureId"]) != int(probe["pathTextureId"]), "terrain texture slots collapsed"):
		return

	var terrain := Terrain3D.new()
	terrain.name = "G00Terrain3DNearDetailProof"
	get_root().add_child(terrain)
	terrain.region_size = 256
	terrain.assets = Terrain3DAssets.new()
	terrain.assets.set_mesh_asset(int(probe["pineMeshId"]), _mesh_asset("Runtime Pine", Color(0.19, 0.39, 0.16, 1.0), Vector2(2.2, 6.0)))
	terrain.assets.set_mesh_asset(int(probe["roundMeshId"]), _mesh_asset("Runtime Round Crown", Color(0.32, 0.55, 0.20, 1.0), Vector2(3.2, 5.0)))
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"):
		return

	terrain.data.import_images([_build_height_image(probe), _build_control_image(probe), _build_color_image(probe)], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() == 1, "Terrain3D near-detail import must produce exactly one region"):
		return

	var positions: Array[int] = []
	for coordinate in range(0, 256, 8):
		positions.push_back(coordinate)
	if positions[-1] != 255:
		positions.push_back(255)
	var max_height_error := 0.0
	var max_blend_error := 0.0
	var max_color_error := 0.0
	var max_roughness_error := 0.0
	var control_checksum: int = 2166136261
	var color_checksum: int = 2166136261
	var sample_count := 0
	var active_roundtrip_samples := 0
	for z in positions:
		for x in positions:
			var u := float(x) / 255.0
			var v := float(z) / 255.0
			var pos := Vector3(float(x), 0.0, float(z))
			var expected_height := _source_height(probe, u, v)
			var expected := _expected_control(probe, u, v)
			var expected_color := _source_color(probe, u, v)
			var actual_height := terrain.data.get_height(pos)
			var actual_blend := terrain.data.get_control_blend(pos)
			var actual_color := terrain.data.get_color(pos)
			var actual_roughness := terrain.data.get_roughness(pos)
			if not _require(not is_nan(actual_height) and not is_nan(actual_blend) and not is_nan(actual_color.r) and not is_nan(actual_roughness), "Terrain3D near-detail data returned NAN"):
				return
			if not _require(terrain.data.get_control_base_id(pos) == int(expected["base"]), "Terrain3D base texture ID changed"):
				return
			if not _require(terrain.data.get_control_overlay_id(pos) == int(expected["overlay"]), "Terrain3D overlay texture ID changed"):
				return
			max_height_error = maxf(max_height_error, absf(actual_height - expected_height))
			max_blend_error = maxf(max_blend_error, absf(actual_blend - float(expected["blend"])))
			max_color_error = maxf(max_color_error, maxf(absf(actual_color.r - expected_color.r), maxf(absf(actual_color.g - expected_color.g), absf(actual_color.b - expected_color.b))))
			max_roughness_error = maxf(max_roughness_error, absf(actual_roughness - expected_color.a))
			if bool(expected["isRoadPath"]) and actual_blend > 0.02:
				active_roundtrip_samples += 1
			control_checksum = int((control_checksum ^ int(round(clampf(actual_blend, 0.0, 1.0) * 255.0))) * 16777619) & 0xffffffff
			for component in [actual_color.r, actual_color.g, actual_color.b, actual_roughness]:
				color_checksum = int((color_checksum ^ int(round(clampf(float(component), 0.0, 1.0) * 255.0))) * 16777619) & 0xffffffff
			sample_count += 1

	if not _require(max_height_error <= MAX_HEIGHT_ERROR, "Terrain3D qualified G00 relief preservation exceeded tolerance"):
		return
	if not _require(max_blend_error <= MAX_BLEND_ERROR, "Terrain3D Road/Path control-map preservation exceeded tolerance"):
		return
	if not _require(max_color_error <= MAX_COLOR_ERROR, "Terrain3D near-detail color roundtrip exceeded tolerance"):
		return
	if not _require(max_roughness_error <= MAX_ROUGHNESS_ERROR, "Terrain3D near-detail roughness roundtrip exceeded tolerance"):
		return
	var road_fingerprint: Dictionary = probe["roadPathFingerprint"]
	var source_active := int(road_fingerprint["activeRoadSamples"]) + int(road_fingerprint["activePathSamples"])
	if source_active > 0 and not _require(active_roundtrip_samples > 0, "active qualified Road/Path vanished during Near Detail import"):
		return
	if source_active == 0 and not _require(active_roundtrip_samples == 0, "Near Detail invented Road/Path coverage"):
		return

	var pine: Array[Transform3D] = []
	var round_crown: Array[Transform3D] = []
	for instance_variant in probe["instances"]:
		var instance: Dictionary = instance_variant
		if not bool(instance["core"]):
			continue
		var transform := _instance_transform(instance, terrain)
		if String(instance["species"]) == "pine":
			pine.push_back(transform)
		elif String(instance["species"]) == "round":
			round_crown.push_back(transform)
		else:
			_fail("unexpected runtime vegetation species")
			return
	var expected_pine := int(probe["vegetation"]["speciesCounts"]["pine"])
	var expected_round := int(probe["vegetation"]["speciesCounts"]["round"])
	if not _require(pine.size() == expected_pine and round_crown.size() == expected_round, "probe vegetation species accounting drifted"):
		return
	if pine.size() > 0:
		terrain.instancer.add_transforms(int(probe["pineMeshId"]), pine, PackedColorArray(), false)
	if round_crown.size() > 0:
		terrain.instancer.add_transforms(int(probe["roundMeshId"]), round_crown, PackedColorArray(), false)
	if pine.size() + round_crown.size() > 0:
		terrain.instancer.update_mmis(true)

	var region := terrain.data.get_region(Vector2i.ZERO)
	if not _require(region != null, "Terrain3D near-detail region missing after import"):
		return
	var stored := _count_region_instances(region)
	if not _require(int(stored[0]) == expected_pine and int(stored[1]) == expected_round, "Terrain3D stored vegetation does not match canonical-filtered runtime transforms"):
		return
	if not _require(_write_imported_preview(terrain, region) == OK, "failed to write Terrain3D near-detail top-down proof"):
		return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "Terrain3D LOD0 near-detail bake returned no mesh"):
		return
	var arrays := baked_mesh.surface_get_arrays(0)
	var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "Terrain3D LOD0 near-detail bake returned no vertices"):
		return

	var suffix := OS.get_environment("G00_NEAR_DETAIL_PROOF_SUFFIX")
	if suffix.is_empty():
		suffix = "default"
	var output_dir := "user://g00-terrain3d-near-detail-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	terrain.data.save_directory(output_dir)
	var saved := _saved_region_evidence(output_dir)
	if not _require(int(saved["count"]) >= 1 and int(saved["totalBytes"]) > 0, "Terrain3D near-detail region resource was not persisted"):
		return

	var metrics := {
		"terrain3dVersion": String(terrain.version),
		"regionSize": int(terrain.region_size),
		"regionCount": terrain.data.get_region_count(),
		"sampleCount": sample_count,
		"activeRoundtripSamples": active_roundtrip_samples,
		"maxHeightError": snappedf(max_height_error, 0.00000001),
		"maxBlendError": snappedf(max_blend_error, 0.00000001),
		"maxColorError": snappedf(max_color_error, 0.00000001),
		"maxRoughnessError": snappedf(max_roughness_error, 0.00000001),
		"controlChecksum": control_checksum,
		"colorChecksum": color_checksum,
		"pineInstances": pine.size(),
		"roundInstances": round_crown.size(),
		"storedInstances": int(stored[0]) + int(stored[1]),
		"instanceChecksum": _stored_instance_checksum(region),
		"bakedSurfaces": baked_mesh.get_surface_count(),
		"bakedVertices": vertices.size(),
		"savedRegionFiles": int(saved["count"]),
		"savedRegionBytes": int(saved["totalBytes"]),
	}
	print("G00_TERRAIN3D_NEAR_DETAIL_METRICS=" + JSON.stringify(metrics))
	print("NW_G00_TERRAIN3D_NEAR_DETAIL_VALIDATION_OK")
	quit(0)
