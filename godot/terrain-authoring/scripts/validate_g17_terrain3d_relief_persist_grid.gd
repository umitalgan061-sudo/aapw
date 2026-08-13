extends SceneTree
const PROBE := "res://.terrain3d-proof/g17-relief-probe.json"
const N := 257
func _initialize() -> void: call_deferred("_run")
func fail(message:String) -> void: push_error("G17 persisted grid failed: "+message); quit(1)
func need(ok:bool,message:String)->bool:
	if not ok: fail(message); return false
	return true
func source_h(p:Dictionary,u:float,v:float)->float:
	var rows:Array=p.rows; var gx:=clampf(u,0,1)*64.0; var gy:=clampf(v,0,1)*64.0
	var x0:=int(floor(gx)); var y0:=int(floor(gy)); var x1:=mini(x0+1,64); var y1:=mini(y0+1,64)
	return lerpf(lerpf(float(rows[y0][x0]),float(rows[y0][x1]),gx-x0),lerpf(float(rows[y1][x0]),float(rows[y1][x1]),gx-x0),gy-y0)
func image_from(p:Dictionary)->Image:
	var image:=Image.create_empty(N,N,false,Image.FORMAT_RF)
	for z in N:
		for x in N: image.set_pixel(x,z,Color(source_h(p,float(x)/256.0,float(z)/256.0),0,0,1))
	return image
func _run()->void:
	if not need(FileAccess.file_exists(PROBE),"probe missing"): return
	var p=JSON.parse_string(FileAccess.get_file_as_string(PROBE)); if not need(p is Dictionary,"probe invalid"): return
	var suffix:=OS.get_environment("G17_RELIEF_GRID_SUFFIX"); if suffix.is_empty(): suffix="default"
	var directory:="user://g17-relief-grid-"+suffix
	var source:=Terrain3D.new(); get_root().add_child(source); source.region_size=256
	if not need(String(source.version).begins_with("1.0.2"),"pinned Terrain3D did not load"): return
	source.data.import_images([image_from(p),null,null],Vector3.ZERO,0.0,1.0); source.data.save_directory(directory)
	var reloaded:=Terrain3D.new(); get_root().add_child(reloaded); reloaded.region_size=256; reloaded.data.load_directory(directory)
	if not need(reloaded.data.get_region_count()>=4,"persisted grid region count regressed"): return
	var max_error:=0.0; var min_h:=INF; var max_h:=-INF; var checksum:int=2166136261; var count:=0
	for z in N:
		for x in N:
			var actual:=reloaded.data.get_height(Vector3(x,0,z)); var expected:=source_h(p,float(x)/256.0,float(z)/256.0)
			if is_nan(actual) or is_inf(actual): fail("non-finite persisted height"); return
			max_error=maxf(max_error,absf(actual-expected)); min_h=minf(min_h,actual); max_h=maxf(max_h,actual); checksum=int((checksum^int(round((actual+32.0)*1000.0)))*16777619)&0xffffffff; count+=1
	if not need(count==N*N and max_error<=float(p.proofContract.maxAlignedHeightErrorMeters),"persisted full-grid roundtrip failed"): return
	if not need(max_h<float(p.waterCeilingMeters) and max_h>min_h,"persisted marine relief range invalid"): return
	var mesh:Mesh=reloaded.bake_mesh(0); if not need(mesh!=null and mesh.get_surface_count()>0,"persisted LOD0 bake empty"): return
	var vertices:PackedVector3Array=mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]; if not need(vertices.size()>0,"persisted LOD0 vertices empty"): return
	print("G17_TERRAIN3D_RELIEF_PERSIST_GRID_METRICS="+JSON.stringify({"samples":count,"regionCount":reloaded.data.get_region_count(),"maxHeightError":snappedf(max_error,0.00000001),"minHeight":snappedf(min_h,0.000001),"maxHeight":snappedf(max_h,0.000001),"checksum":checksum,"bakedVertices":vertices.size()})); print("SW_G17_TERRAIN3D_RELIEF_PERSIST_GRID_OK"); quit(0)
