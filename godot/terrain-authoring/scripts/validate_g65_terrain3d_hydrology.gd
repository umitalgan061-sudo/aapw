extends SceneTree
const SOURCE_PATH := "res://.terrain3d-proof/g65-hydrology-source.json"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
func _initialize()->void: call_deferred("_run")
func _fail(m:String)->void: push_error(m);quit(1)
func _sample(a:Array,u:float,v:float)->float:
 var gx=clampf(u,0,1)*64.0;var gy=clampf(v,0,1)*64.0;var x0=int(floor(gx));var y0=int(floor(gy));var x1=mini(x0+1,64);var y1=mini(y0+1,64);var tx=gx-x0;var ty=gy-y0
 return lerpf(lerpf(float(a[y0*65+x0]),float(a[y0*65+x1]),tx),lerpf(float(a[y1*65+x0]),float(a[y1*65+x1]),tx),ty)
func _run()->void:
 if not FileAccess.file_exists(SOURCE_PATH): _fail("missing G65 source");return
 var f=FileAccess.open(SOURCE_PATH,FileAccess.READ);var s=JSON.parse_string(f.get_as_text());f.close()
 if not s is Dictionary or String(s.get("schema",""))!="westeros-g65-hydrology-v1": _fail("bad source schema");return
 var h:Array=s["heights"];if h.size()!=4225:_fail("bad height channel");return
 var image=Image.create_empty(IMPORT_SIZE,IMPORT_SIZE,false,Image.FORMAT_RF)
 for z in IMPORT_SIZE:
  for x in IMPORT_SIZE:image.set_pixel(x,z,Color(_sample(h,float(x)/256.0,float(z)/256.0),0,0,1))
 var terrain=Terrain3D.new();get_root().add_child(terrain);terrain.region_size=256
 if not String(terrain.version).begins_with("1.0.2"):_fail("wrong Terrain3D version");return
 terrain.data.import_images([image,null,null],Vector3.ZERO,0.0,1.0)
 if terrain.data.get_region_count()<4:_fail("guard-backed import needs four regions");return
 var max_error=0.0
 for y in SOURCE_SIZE:
  for x in SOURCE_SIZE:
   var p=Vector3(float(x*4),0,float(y*4));var actual=terrain.data.get_height(p);if is_nan(actual):_fail("NAN height");return
   max_error=maxf(max_error,absf(actual-_sample(h,float(x)/64.0,float(y)/64.0)))
 if max_error>0.012:_fail("height parity exceeded tolerance");return
 for px in [254.5,255.0,255.5,256.0]:
  if is_nan(terrain.data.get_height(Vector3(px,0,255.5))):_fail("NAN region seam");return
 var mesh:Mesh=terrain.bake_mesh(0);if mesh==null or mesh.get_surface_count()<1:_fail("empty LOD0 bake");return
 var verts:PackedVector3Array=mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX];if verts.is_empty():_fail("empty LOD0 vertices");return
 var suffix=OS.get_environment("G65_HYDROLOGY_PROOF_SUFFIX");if suffix.is_empty():suffix="default"
 var save_dir="user://g65-terrain3d-hydrology-"+suffix;DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(save_dir));terrain.data.save_directory(save_dir)
 print("G65_TERRAIN3D_HYDROLOGY_METRICS="+JSON.stringify({"regionCount":terrain.data.get_region_count(),"bakedVertices":verts.size(),"maxHeightError":max_error}));print("SE_G65_TERRAIN3D_HYDROLOGY_OK");quit(0)
