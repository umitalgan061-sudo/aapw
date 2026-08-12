extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g11-near-detail-probe.json"
const EXPECTED_POLICY := "buzul-muhafizi-g11-terrain3d-near-detail-2026-08-12-v1"
const EXPECTED_SOURCE_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const G11_MIN := 0.125
const G11_MAX := 0.25

func _initialize() -> void:
	call_deferred("_run")

func _fail(message: String) -> void:
	push_error("G11 Terrain3D near-detail proof failed: " + message)
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

func _flat_height_image(size: int) -> Image:
	var image := Image.create_empty(size, size, false, Image.FORMAT_RF)
	image.fill(Color(12.0, 0.0, 0.0, 1.0))
	return image

func _is_core(instance: Dictionary) -> bool:
	var nx := float(instance["normalizedX"])
	var ny := float(instance["normalizedY"])
	return nx >= G11_MIN and nx <= G11_MAX and ny >= G11_MIN and ny <= G11_MAX

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
	for mesh_id in instances.keys():
		var cells: Dictionary = instances[mesh_id]
		for cell_key in cells.keys():
			var payload: Array = cells[cell_key]
			var transforms: Array = payload[0]
			counts[int(mesh_id)] = int(counts.get(int(mesh_id), 0)) + transforms.size()
	return counts

func _stored_checksum(region: Terrain3DRegion) -> int:
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

func _write_stored_topdown(region: Terrain3DRegion) -> Error:
	var image := Image.create_empty(256, 256, false, Image.FORMAT_RGBA8)
	image.fill(Color(0.08, 0.11, 0.09, 1.0))
	var instances: Dictionary = region.instances
	for mesh_id_variant in instances.keys():
		var mesh_id := int(mesh_id_variant)
		var color := Color(0.22, 0.52, 0.25, 1.0) if mesh_id == 0 else Color(0.45, 0.72, 0.34, 1.0)
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
						var x := px + ox
						var y := py + oy
						if x >= 0 and x < 256 and y >= 0 and y < 256:
							image.set_pixel(x, y, color)
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof"))
	return image.save_png("res://.terrain3d-proof/g11-near-detail-imported-topdown.png")

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
	if not _require(FileAccess.file_exists(PROBE_PATH), "G11 near-detail probe JSON missing"):
		return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary, "probe JSON did not decode to Dictionary"):
		return
	var probe: Dictionary = parsed
	if not _require(String(probe["policyId"]) == EXPECTED_POLICY, "unexpected near-detail policy"):
		return
	if not _require(String(probe["sourceMapSha256"]) == EXPECTED_SOURCE_SHA, "owner-map SHA changed"):
		return
	if not _require(int(probe["terrain3dRegionSize"]) == 256, "Terrain3D proof region must be 256"):
		return

	var terrain := Terrain3D.new()
	terrain.name = "G11Terrain3DNearDetailProof"
	get_root().add_child(terrain)
	terrain.region_size = 256
	terrain.assets = Terrain3DAssets.new()
	terrain.assets.set_mesh_asset(0, _mesh_asset("Runtime Pine", Color(0.19, 0.39, 0.16, 1.0), Vector2(2.2, 6.0)))
	terrain.assets.set_mesh_asset(1, _mesh_asset("Runtime Round Crown", Color(0.32, 0.55, 0.20, 1.0), Vector2(3.2, 5.0)))
	if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"):
		return

	terrain.data.import_images([_flat_height_image(256), null, null], Vector3.ZERO, 0.0, 1.0)
	if not _require(terrain.data.get_region_count() == 1, "near-detail terrain import did not create one region"):
		return

	var pine: Array[Transform3D] = []
	var round_crown: Array[Transform3D] = []
	for instance_variant in probe["instances"]:
		var instance: Dictionary = instance_variant
		if not _is_core(instance):
			continue
		var transform := _instance_transform(instance, terrain)
		if String(instance["species"]) == "pine":
			pine.push_back(transform)
		elif String(instance["species"]) == "round":
			round_crown.push_back(transform)
		else:
			_fail("unexpected runtime vegetation species")
			return
	if not _require(pine.size() > 0 and round_crown.size() > 0, "both real runtime vegetation species must reach Terrain3D"):
		return

	terrain.instancer.add_transforms(0, pine, PackedColorArray(), false)
	terrain.instancer.add_transforms(1, round_crown, PackedColorArray(), false)
	terrain.instancer.update_mmis(true)

	var region := terrain.data.get_region(Vector2i.ZERO)
	if not _require(region != null, "Terrain3D near-detail region missing after instancing"):
		return
	var stored := _count_region_instances(region)
	if not _require(int(stored[0]) == pine.size() and int(stored[1]) == round_crown.size(), "Terrain3D region instance storage does not match runtime transforms"):
		return
	if not _require(_write_stored_topdown(region) == OK, "failed to write Terrain3D stored-instance top-down"):
		return

	var baked_mesh: Mesh = terrain.bake_mesh(0)
	if not _require(baked_mesh != null and baked_mesh.get_surface_count() > 0, "Terrain3D LOD0 bake returned no terrain mesh"):
		return
	var arrays := baked_mesh.surface_get_arrays(0)
	var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size() > 0, "Terrain3D LOD0 bake returned no terrain vertices"):
		return

	var suffix := OS.get_environment("G11_NEAR_DETAIL_PROOF_SUFFIX")
	if suffix.is_empty():
		suffix = "default"
	var output_dir := "user://g11-terrain3d-near-detail-proof-" + suffix
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	terrain.data.save_directory(output_dir)
	var saved := _saved_region_evidence(output_dir)
	if not _require(int(saved["count"]) >= 1 and int(saved["totalBytes"]) > 0, "Terrain3D instance-bearing region was not persisted"):
		return

	var metrics := {
		"terrain3dVersion": String(terrain.version),
		"regionSize": int(terrain.region_size),
		"regionCount": terrain.data.get_region_count(),
		"pineInstances": pine.size(),
		"roundInstances": round_crown.size(),
		"storedInstances": int(stored[0]) + int(stored[1]),
		"instanceChecksum": _stored_checksum(region),
		"bakedSurfaces": baked_mesh.get_surface_count(),
		"bakedVertices": vertices.size(),
		"savedRegionFiles": int(saved["count"]),
		"savedRegionBytes": int(saved["totalBytes"]),
	}
	print("G11_TERRAIN3D_NEAR_DETAIL_METRICS=" + JSON.stringify(metrics))
	print("NW_G11_TERRAIN3D_NEAR_DETAIL_VALIDATION_OK")
	quit(0)
