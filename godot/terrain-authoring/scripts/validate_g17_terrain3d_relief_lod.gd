extends SceneTree
const PROBE := "res://.terrain3d-proof/g17-relief-probe.json"
const N := 257
const MARINE := Color(0.04,0.12,0.18,0.72)

func _initialize() -> void: call_deferred("_run")
func fail(message:String) -> void: push_error("G17 Terrain3D LOD audit failed: "+message); quit(1)
func need(ok:bool,message:String)->bool:
	if not ok: fail(message); return false
	return true
func source_h(p:Dictionary,u:float,v:float)->float:
	var rows:Array=p.rows; var gx:=clampf(u,0,1)*64.0; var gy:=clampf(v,0,1)*64.0
	var x0:=int(floor(gx)); var y0:=int(floor(gy)); var x1:=mini(x0+1,64); var y1:=mini(y0+1,64)
	return lerpf(lerpf(float(rows[y0][x0]),float(rows[y0][x1]),gx-x0),lerpf(float(rows[y1][x0]),float(rows[y1][x1]),gx-x0),gy-y0)
func maps_from(p:Dictionary)->Array:
	var height:=Image.create_empty(N,N,false,Image.FORMAT_RF); var control:=Image.create_empty(N,N,false,Image.FORMAT_RF); var color:=Image.create_empty(N,N,false,Image.FORMAT_RGBA8)
	control.fill(Color(0,0,0,1)); color.fill(MARINE)
	for z in N:
		for x in N: height.set_pixel(x,z,Color(source_h(p,float(x)/256.0,float(z)/256.0),0,0,1))
	return [height,control,color]
func maps_ok(t:Terrain3D)->bool:
	var c:=t.data.get_color(Vector3(128,0,128)); var rough:=t.data.get_roughness(Vector3(128,0,128))
	return t.data.get_height_maps().size()>=4 and t.data.get_control_maps().size()>=4 and t.data.get_color_maps().size()>=4 and absf(c.r-MARINE.r)<=0.01 and absf(c.g-MARINE.g)<=0.01 and absf(c.b-MARINE.b)<=0.01 and absf(rough-MARINE.a)<=0.01
func _run()->void:
	if not need(FileAccess.file_exists(PROBE),"probe missing"): return
	var p=JSON.parse_string(FileAccess.get_file_as_string(PROBE)); if not need(p is Dictionary,"probe invalid"): return
	var source:=Terrain3D.new(); get_root().add_child(source); source.region_size=256
	if not need(String(source.version).begins_with("1.0.2"),"pinned Terrain3D did not load"): return
	source.data.import_images(maps_from(p),Vector3.ZERO,0.0,1.0)
	if not need(source.data.get_region_count()>=4 and maps_ok(source),"height/control/color import failed"): return
	var directory:="user://g17-relief-lod-maps"; DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(directory)); source.data.save_directory(directory)
	var t:=Terrain3D.new(); get_root().add_child(t); t.region_size=256; t.data.load_directory(directory)
	if not need(t.data.get_region_count()==source.data.get_region_count() and maps_ok(t),"persisted map roundtrip failed"): return
	var levels:Array=[]; var previous_vertices:=2147483647
	for lod in [0,1,2]:
		var mesh:Mesh=t.bake_mesh(lod); if not need(mesh!=null and mesh.get_surface_count()>0,"LOD%d bake empty"%lod): return
		var vertices:PackedVector3Array=mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]; if not need(vertices.size()>0,"LOD%d vertices empty"%lod): return
		if not need(vertices.size()<previous_vertices,"LOD%d did not decimate"%lod): return
		previous_vertices=vertices.size(); var min_h:=INF; var max_h:=-INF; var checksum:int=2166136261
		for vertex in vertices:
			if is_nan(vertex.y) or is_inf(vertex.y): fail("LOD%d non-finite vertex"%lod); return
			min_h=minf(min_h,vertex.y); max_h=maxf(max_h,vertex.y); checksum=int((checksum^int(round((vertex.y+32.0)*1000.0)))*16777619)&0xffffffff
		if not need(max_h<float(p.waterCeilingMeters) and max_h>min_h,"LOD%d marine relief range invalid"%lod): return
		var aabb:=mesh.get_aabb(); levels.append({"lod":lod,"surfaces":mesh.get_surface_count(),"vertices":vertices.size(),"minHeight":snappedf(min_h,0.000001),"maxHeight":snappedf(max_h,0.000001),"checksum":checksum,"aabbX":snappedf(aabb.size.x,0.001),"aabbZ":snappedf(aabb.size.z,0.001)})
	var c:=t.data.get_color(Vector3(128,0,128)); print("G17_TERRAIN3D_RELIEF_LOD_METRICS="+JSON.stringify({"terrain3dVersion":String(t.version),"regionCount":t.data.get_region_count(),"heightMaps":t.data.get_height_maps().size(),"controlMaps":t.data.get_control_maps().size(),"colorMaps":t.data.get_color_maps().size(),"color":[snappedf(c.r,0.0001),snappedf(c.g,0.0001),snappedf(c.b,0.0001)],"roughness":snappedf(t.data.get_roughness(Vector3(128,0,128)),0.0001),"levels":levels})); print("SW_G17_TERRAIN3D_RELIEF_LOD_OK"); quit(0)
