extends SceneTree

const SOURCE_PATH := "res://.terrain3d-proof/g65-hydrology-source.json"
const EXPECTED_SCHEMA := "westeros-g65-hydrology-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const HEIGHT_TOLERANCE := 0.012

func _initialize() -> void:
  call_deferred("_run")

func _fail(message: String) -> void:
  push_error("G65 Terrain3D hydrology proof failed: " + message)
  quit(1)

func _require(condition: bool, message: String) -> bool:
  if not condition:
    _fail(message)
    return false
  return true

func _sample(values: Array, u: float, v: float) -> float:
  var gx := clampf(u, 0.0, 1.0) * float(SOURCE_SIZE - 1)
  var gy := clampf(v, 0.0, 1.0) * float(SOURCE_SIZE - 1)
  var x0 := int(floor(gx))
  var y0 := int(floor(gy))
  var x1 := mini(x0 + 1, SOURCE_SIZE - 1)
  var y1 := mini(y0 + 1, SOURCE_SIZE - 1)
  var tx := gx - float(x0)
  var ty := gy - float(y0)
  var a := float(values[y0 * SOURCE_SIZE + x0])
  var b := float(values[y0 * SOURCE_SIZE + x1])
  var c := float(values[y1 * SOURCE_SIZE + x0])
  var d := float(values[y1 * SOURCE_SIZE + x1])
  return lerpf(lerpf(a, b, tx), lerpf(c, d, tx), ty)

func _build_height_image(values: Array) -> Image:
  var image := Image.create_empty(IMPORT_SIZE, IMPORT_SIZE, false, Image.FORMAT_RF)
  for z in IMPORT_SIZE:
    var v := float(z) / float(IMPORT_SIZE - 1)
    for x in IMPORT_SIZE:
      var u := float(x) / float(IMPORT_SIZE - 1)
      image.set_pixel(x, z, Color(_sample(values, u, v), 0.0, 0.0, 1.0))
  return image

func _run() -> void:
  if not FileAccess.file_exists(SOURCE_PATH):
    _fail("missing source JSON")
    return
  var file := FileAccess.open(SOURCE_PATH, FileAccess.READ)
  var parsed = JSON.parse_string(file.get_as_text())
  file.close()
  if not _require(parsed is Dictionary, "source JSON must be an object"): return
  var source: Dictionary = parsed
  if not _require(String(source.get("schema", "")) == EXPECTED_SCHEMA, "unexpected source schema"): return
  if not _require(String(source.get("sourceMapSha256", "")) == EXPECTED_MAP_SHA, "map.png provenance changed"): return
  if not _require(int(source.get("size", 0)) == SOURCE_SIZE, "source must remain 65x65"): return
  if not _require(source.get("heights", []) is Array and (source["heights"] as Array).size() == SOURCE_SIZE * SOURCE_SIZE, "invalid height channel"): return

  var terrain := Terrain3D.new()
  terrain.name = "G65Terrain3DHydrologyProof"
  get_root().add_child(terrain)
  terrain.region_size = REGION_SIZE
  if not _require(String(terrain.version).begins_with("1.0.2"), "pinned Terrain3D v1.0.2 did not load"): return

  var height_image := _build_height_image(source["heights"])
  terrain.data.import_images([height_image, null, null], Vector3.ZERO, 0.0, 1.0)
  var region_count := terrain.data.get_region_count()
  if not _require(region_count >= 4, "257x257 guard-backed import did not create four regions"): return

  var max_error := 0.0
  for sy in SOURCE_SIZE:
    var v := float(sy) / float(SOURCE_SIZE - 1)
    for sx in SOURCE_SIZE:
      var u := float(sx) / float(SOURCE_SIZE - 1)
      var pos := Vector3(float(sx * 4), 0.0, float(sy * 4))
      var actual := terrain.data.get_height(pos)
      if not _require(not is_nan(actual), "non-finite Terrain3D height sample"): return
      max_error = maxf(max_error, absf(actual - _sample(source["heights"], u, v)))
  if not _require(max_error <= HEIGHT_TOLERANCE, "Terrain3D height round-trip exceeded tolerance"): return

  for px in [254.5, 255.0, 255.5, 256.0]:
    for pz in [64.0, 128.0, 192.0, 255.5]:
      if not _require(not is_nan(terrain.data.get_height(Vector3(px, 0.0, pz))), "NAN at 255/256 region seam"): return

  var baked: Mesh = terrain.bake_mesh(0)
  if not _require(baked != null and baked.get_surface_count() > 0, "LOD0 bake returned no mesh"): return
  var vertices: PackedVector3Array = baked.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
  if not _require(vertices.size() > 0, "LOD0 bake returned no vertices"): return

  var suffix := OS.get_environment("G65_HYDROLOGY_PROOF_SUFFIX")
  if suffix.is_empty(): suffix = "default"
  var save_dir := "user://g65-terrain3d-hydrology-" + suffix
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir))
  terrain.data.save_directory(save_dir)

  print("G65_TERRAIN3D_HYDROLOGY_METRICS=" + JSON.stringify({"regionCount": region_count, "bakedVertices": vertices.size(), "maxHeightError": max_error}))
  print("SE_G65_TERRAIN3D_HYDROLOGY_OK")
  quit(0)
