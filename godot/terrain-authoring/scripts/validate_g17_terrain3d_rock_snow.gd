extends SceneTree
const PROBE := "res://.terrain3d-proof/g17-rock-snow-probe.json"
const PREVIEW := "res://.terrain3d-proof/g17-rock-snow-imported-topdown.png"
const N := 257
const REGION := 256

func _initialize() -> void: call_deferred("_run")
func fail(message:String) -> void: push_error("G17 Terrain3D Rock/Snow proof failed: "+message); quit(1)
func need(ok:bool,message:String)->bool:
	if not ok: fail(message); return false
	return true

func value_at(p:Dictionary,x:float,z:float,channel:int)->float:
	var gx:=clampf(x,0.0,256.0); var gz:=clampf(z,0.0,256.0)
	var x0:=int(floor(gx)); var z0:=int(floor(gz)); var x1:=mini(x0+1,256); var z1:=mini(z0+1,256)
	var tx:=gx-x0; var tz:=gz-z0; var rows:Array=p.rows
	return lerpf(lerpf(float(rows[z0][x0][channel]),float(rows[z0][x1][channel]),tx),lerpf(float(rows[z1][x0][channel]),float(rows[z1][x1][channel]),tx),tz)

func control_float(base_id:int,overlay_id:int,blend_u8:int)->float:
	var bits:int=((base_id&0x1f)<<27)|((overlay_id&0x1f)<<22)|((blend_u8&0xff)<<14)
	var packed:=PackedByteArray(); packed.resize(4); packed.encode_u32(0,bits)
	return packed.decode_float(0)

func images(p:Dictionary)->Array:
	var h:=Image.create_empty(N,N,false,Image.FORMAT_RF); var c:=Image.create_empty(N,N,false,Image.FORMAT_RF)
	for z in N:
		for x in N:
			var s:Array=p.rows[z][x]; h.set_pixel(x,z,Color(float(s[3]),0,0,1))
			c.set_pixel(x,z,Color(control_float(int(s[0]),int(s[1]),int(s[2])),0,0,1))
	return [h,c,null]

func saved_evidence(directory:String)->Dictionary:
	var d:=DirAccess.open(directory); if d==null: return {}
	var files:=0; var bytes:=0; d.list_dir_begin(); var name:=d.get_next()
	while name!="":
		if not d.current_is_dir(): files+=1; bytes+=FileAccess.get_file_as_bytes(directory.path_join(name)).size()
		name=d.get_next()
	d.list_dir_end(); return {"files":files,"bytes":bytes}

func aligned_proof(t,p:Dictionary)->Dictionary:
	var mh:=0.0; var mb:=0.0; var count:=0; var checksum:int=2166136261
	for sz in 65:
		for sx in 65:
			var x:=sx*4; var z:=sz*4; var s:Array=p.rows[z][x]; var pos:=Vector3(x,0,z)
			var ah:=t.data.get_height(pos); var ab:=t.data.get_control_blend(pos)
			if is_nan(ah) or is_nan(ab): return {}
			if t.data.get_control_base_id(pos)!=int(s[0]) or t.data.get_control_overlay_id(pos)!=int(s[1]): return {}
			mh=maxf(mh,absf(ah-float(s[3]))); mb=maxf(mb,absf(ab-float(s[2])/255.0)); count+=1
			checksum=int((checksum^int(round((ah+32.0)*1000.0)))*16777619)&0xffffffff
			checksum=int((checksum^int(round(ab*255.0)))*16777619)&0xffffffff
	return {"height":mh,"blend":mb,"count":count,"checksum":checksum}

func seam_proof(t,p:Dictionary)->Dictionary:
	var mh:=0.0; var heights:=0
	for edge in [254.5,255.0,255.5,256.0]:
		for other in [32.25,72.5,112.75,153.25,193.5,233.75]:
			for q in [Vector2(edge,other),Vector2(other,edge)]:
				var a:=t.data.get_height(Vector3(q.x,0,q.y)); if is_nan(a): return {}
				mh=maxf(mh,absf(a-value_at(p,q.x,q.y,3))); heights+=1
	var mb:=0.0; var controls:=0
	for edge in [255,256]:
		for other in [16,64,128,192,240]:
			for q in [Vector2(edge,other),Vector2(other,edge)]:
				var s:Array=p.rows[int(q.y)][int(q.x)]; var pos:=Vector3(q.x,0,q.y); var b:=t.data.get_control_blend(pos)
				if is_nan(b) or t.data.get_control_base_id(pos)!=int(s[0]) or t.data.get_control_overlay_id(pos)!=int(s[1]): return {}
				mb=maxf(mb,absf(b-float(s[2])/255.0)); controls+=1
	return {"height":mh,"blend":mb,"heights":heights,"controls":controls}

func write_preview(t)->bool:
	var image:=Image.create_empty(256,256,false,Image.FORMAT_RGB8)
	for z in 256:
		for x in 256:
			var b:=t.data.get_control_blend(Vector3(x,0,z)); if is_nan(b): return false
			image.set_pixel(x,z,Color(0.12,0.10,0.08).lerp(Color(0.30,0.31,0.32),clampf(b,0,1)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(PREVIEW).get_base_dir()); return image.save_png(PREVIEW)==OK

func _run()->void:
	if not need(FileAccess.file_exists(PROBE),"probe missing"): return
	var p=JSON.parse_string(FileAccess.get_file_as_string(PROBE)); if not need(p is Dictionary,"probe invalid"): return
	if not need(String(p.policyId)=="gunbatimi-ustasi-g17-terrain3d-rock-snow-2026-08-13-v1","policy changed"): return
	if not need(String(p.sourceMapSha256)=="20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1","map SHA changed"): return
	if not need(int(p.regionSize)==REGION and int(p.importSize)==N and int(p.samples)==66049 and int(p.baseTextureId)==0 and int(p.overlayTextureId)==1 and float(p.maxSnowWeight)==0.0,"probe contract changed"): return
	if not need(ClassDB.class_exists("Terrain3D"),"Terrain3D class not registered"): return
	var t:Variant=ClassDB.instantiate("Terrain3D"); if not need(t!=null,"Terrain3D instantiate failed"): return
	get_root().add_child(t); t.region_size=REGION
	if not need(String(t.version).begins_with("1.0.2"),"pinned Terrain3D did not load"): return
	t.data.import_images(images(p),Vector3.ZERO,0.0,1.0); if not need(t.data.get_region_count()>=4,"257 import must create >=4 regions"): return
	var a:=aligned_proof(t,p); if not need(not a.is_empty() and int(a.count)==4225 and float(a.height)<=0.012 and float(a.blend)<=0.006,"aligned Height+Control roundtrip failed"): return
	var s:=seam_proof(t,p); if not need(not s.is_empty() and int(s.heights)==48 and int(s.controls)==20 and float(s.height)<=0.02 and float(s.blend)<=0.006,"255/256 seam roundtrip failed"): return
	var mesh:Mesh=t.bake_mesh(0); if not need(mesh!=null and mesh.get_surface_count()>0,"LOD0 bake empty"): return
	var vertices:PackedVector3Array=mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]; if not need(vertices.size()>0,"LOD0 vertices empty"): return
	var suffix:=OS.get_environment("G17_ROCK_SNOW_PROOF_SUFFIX"); if suffix.is_empty(): suffix="default"
	var out:="user://g17-rock-snow-"+suffix; DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(out)); t.data.save_directory(out)
	var saved:=saved_evidence(out); if not need(int(saved.files)>=4 and int(saved.bytes)>0,"region persistence failed"): return
	var r:Variant=ClassDB.instantiate("Terrain3D"); if not need(r!=null,"Terrain3D reload instantiate failed"): return
	get_root().add_child(r); r.region_size=REGION; r.data.load_directory(out)
	if not need(r.data.get_region_count()>=4,"reload regions missing"): return
	var ra:=aligned_proof(r,p); if not need(not ra.is_empty() and int(ra.count)==4225 and float(ra.height)<=0.012 and float(ra.blend)<=0.006 and int(ra.checksum)==int(a.checksum),"save/reload parity failed"): return
	if not need(write_preview(r),"preview failed"): return
	var m={"terrain3dVersion":String(t.version),"regionSize":REGION,"regionCount":t.data.get_region_count(),"alignedSamples":a.count,"seamSamples":s.heights,"controlSeamSamples":s.controls,"maxHeightError":snappedf(a.height,0.00000001),"maxBlendError":snappedf(a.blend,0.00000001),"maxSeamHeightError":snappedf(s.height,0.00000001),"maxSeamBlendError":snappedf(s.blend,0.00000001),"maxSourceSnowWeight":float(p.maxSnowWeight),"outputChecksum":a.checksum,"bakedSurfaces":mesh.get_surface_count(),"bakedVertices":vertices.size(),"savedRegionFiles":saved.files,"savedRegionBytes":saved.bytes}
	print("G17_TERRAIN3D_ROCK_SNOW_METRICS="+JSON.stringify(m)); print("SW_G17_TERRAIN3D_ROCK_SNOW_VALIDATION_OK"); quit(0)
