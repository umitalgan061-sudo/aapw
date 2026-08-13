extends SceneTree
const PROBE := "res://.terrain3d-proof/g77-relief-probe.json"
const N := 257
func _initialize() -> void: call_deferred("_run")
func _fail(message:String)->void: push_error("G77 Terrain3D LOD audit failed: "+message); quit(1)
func _need(ok:bool,message:String)->bool:
	if not ok: _fail(message); return false
	return true
func _height(probe:Dictionary,u:float,v:float)->float:
	var rows:Array=probe["rows"]; var gx:=clampf(u,0,1)*64.0; var gy:=clampf(v,0,1)*64.0; var x0:=int(floor(gx)); var y0:=int(floor(gy)); var x1:=mini(x0+1,64); var y1:=mini(y0+1,64); var tx:=gx-x0; var ty:=gy-y0
	return lerpf(lerpf(float(rows[y0][x0]),float(rows[y0][x1]),tx),lerpf(float(rows[y1][x0]),float(rows[y1][x1]),tx),ty)
func _image(probe:Dictionary)->Image:
	var image:=Image.create_empty(N,N,false,Image.FORMAT_RF)
	for z in N:
		for x in N: image.set_pixel(x,z,Color(_height(probe,float(x)/256.0,float(z)/256.0),0,0,1))
	return image
func _run()->void:
	if not _need(FileAccess.file_exists(PROBE),"probe missing"): return
	var parsed=JSON.parse_string(FileAccess.get_file_as_string(PROBE)); if not _need(parsed is Dictionary,"probe invalid"): return
	var terrain:=Terrain3D.new(); get_root().add_child(terrain); terrain.region_size=256
	if not _need(String(terrain.version).begins_with("1.0.2"),"pinned Terrain3D did not load"): return
	terrain.data.import_images([_image(parsed),null,null],Vector3.ZERO,0.0,1.0); if not _need(terrain.data.get_region_count()>=4,"Terrain3D region count regressed"): return
	var levels:Array=[]; var previous:=2147483647
	for lod in [0,1,2]:
		var mesh:Mesh=terrain.bake_mesh(lod); if not _need(mesh!=null and mesh.get_surface_count()>0,"LOD%d bake empty"%lod): return
		var vertices:PackedVector3Array=mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]; if not _need(vertices.size()>0 and vertices.size()<previous,"LOD%d did not decimate"%lod): return
		previous=vertices.size(); var min_h:=INF; var max_h:=-INF; var checksum:int=2166136261
		for vertex in vertices:
			if is_nan(vertex.y) or is_inf(vertex.y): _fail("LOD%d non-finite vertex"%lod); return
			min_h=minf(min_h,vertex.y); max_h=maxf(max_h,vertex.y); checksum=int((checksum^int(round((vertex.y+128.0)*1000.0)))*16777619)&0xffffffff
		if not _need(min_h<0.0 and max_h>0.0,"LOD%d lost mixed height range"%lod): return
		levels.append({"lod":lod,"surfaces":mesh.get_surface_count(),"vertices":vertices.size(),"minHeight":snappedf(min_h,0.000001),"maxHeight":snappedf(max_h,0.000001),"checksum":checksum})
	print("G77_TERRAIN3D_RELIEF_LOD_METRICS="+JSON.stringify({"terrain3dVersion":String(terrain.version),"regionCount":terrain.data.get_region_count(),"levels":levels})); print("SE_G77_TERRAIN3D_RELIEF_LOD_OK"); quit(0)
