extends SceneTree
const P := "res://.terrain3d-proof/g17-road-path-probe.json"
const OUT := "user://g17-road-path-proof"
func _initialize()->void: call_deferred("_run")
func fail(m:String)->void: push_error("G17 Road/Path proof failed: "+m); quit(1)
func need(v:bool,m:String)->bool:
	if not v: fail(m); return false
	return true
func ctl(base:int,overlay:int,blend:int)->float:
	return Terrain3DUtil.as_float(Terrain3DUtil.enc_base(base)|Terrain3DUtil.enc_overlay(overlay)|Terrain3DUtil.enc_blend(blend))
func _run()->void:
	if not need(FileAccess.file_exists(P),"probe missing"): return
	var q=JSON.parse_string(FileAccess.get_file_as_string(P))
	if not need(q is Dictionary and String(q.policyId)=="gunbatimi-ustasi-g17-terrain3d-road-path-2026-08-14-v1","policy changed"): return
	if not need(String(q.sourceMapSha256)=="20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1","map SHA changed"): return
	if not need(int(q.roadCrossings)==0 and int(q.pathCrossings)==0 and float(q.maxRoadCoverage)==0.0 and float(q.maxPathCoverage)==0.0,"source road/path exclusion failed"): return
	if not need(int(q.importSize)==257 and int(q.regionSize)==256 and ClassDB.class_exists("Terrain3D"),"Terrain3D source contract failed"): return
	var t:Terrain3D=Terrain3D.new(); get_root().add_child(t); t.region_size=256
	if not need(String(t.version).begins_with("1.0.2"),"Terrain3D pin changed"): return
	var h:=Image.create_empty(257,257,false,Image.FORMAT_RF); var c:=Image.create_empty(257,257,false,Image.FORMAT_RF); var color:=Image.create_empty(257,257,false,Image.FORMAT_RGBA8)
	for z in 257:
		for x in 257:
			var s:Array=q.rows[z][x]; var rgba:Array=q.colors[z][x]
			h.set_pixel(x,z,Color(float(s[3]),0,0,1)); c.set_pixel(x,z,Color(ctl(int(s[0]),int(s[1]),int(s[2])),0,0,1)); color.set_pixel(x,z,Color(float(rgba[0]),float(rgba[1]),float(rgba[2]),float(rgba[3])))
	t.data.import_images([h,c,color],Vector3.ZERO,0.0,1.0)
	if not need(t.data.get_region_count()>=4,"257 Height+Control+Color import did not create four regions"): return
	var max_h:=0.0; var max_b:=0.0; var max_color:=0.0; var count:=0; var checksum:int=2166136261
	for z in range(0,257,4):
		for x in range(0,257,4):
			var s:Array=q.rows[z][x]; var rgba:Array=q.colors[z][x]; var p:=Vector3(x,0,z)
			var base:int=t.data.get_control_base_id(p); var overlay:int=t.data.get_control_overlay_id(p); var actual:Color=t.data.get_color(p); var roughness:float=float(t.data.get_roughness(p))
			var blend:float=float(t.data.get_control_blend(p)); var height:float=float(t.data.get_height(p))
			if not need(base==int(s[0]) and overlay==int(s[1]) and overlay!=int(q.roadTextureId) and overlay!=int(q.pathTextureId),"phantom road/path texture"): return
			max_h=maxf(max_h,absf(height-float(s[3]))); max_b=maxf(max_b,absf(blend-float(s[2])/255.0))
			max_color=maxf(max_color,maxf(absf(actual.r-float(rgba[0])),maxf(absf(actual.g-float(rgba[1])),maxf(absf(actual.b-float(rgba[2])),absf(roughness-float(rgba[3]))))))
			checksum=int((checksum^int(round(blend*255.0)))*16777619)&0xffffffff; count+=1
	if not need(count==4225 and max_h<=0.012 and max_b<=0.006 and max_color<=0.006,"Height+Control+Color roundtrip exceeded tolerance"): return
	var preview:=Image.create_empty(256,256,false,Image.FORMAT_RGB8)
	for z in 256:
		for x in 256:
			var p:=Vector3(x,0,z); var overlay:int=t.data.get_control_overlay_id(p)
			preview.set_pixel(x,z,Color(1,0,0) if overlay==int(q.roadTextureId) or overlay==int(q.pathTextureId) else t.data.get_color(p))
	if not need(preview.save_png("res://.terrain3d-proof/g17-road-path-imported-topdown.png")==OK,"preview write failed"): return
	var mesh:Mesh=t.bake_mesh(0)
	if not need(mesh!=null and mesh.get_surface_count()>0 and mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX].size()>0,"LOD0 bake empty"): return
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUT)); t.data.save_directory(OUT)
	var d:=DirAccess.open(OUT); var files:=0; d.list_dir_begin(); var name:=d.get_next()
	while name!="":
		if not d.current_is_dir(): files+=1
		name=d.get_next()
	d.list_dir_end()
	if not need(files>=4,"Terrain3D regions not persisted"): return
	print("G17_TERRAIN3D_ROAD_PATH_METRICS="+JSON.stringify({"regions":t.data.get_region_count(),"samples":count,"maxHeightError":max_h,"maxBlendError":max_b,"maxColorError":max_color,"checksum":checksum,"bakedSurfaces":mesh.get_surface_count(),"savedRegionFiles":files}))
	print("SW_G17_TERRAIN3D_ROAD_PATH_VALIDATION_OK"); quit(0)
