extends SceneTree
const PROBE := "res://.terrain3d-proof/g17-relief-probe.json"
const PREVIEW := "res://.terrain3d-proof/g17-relief-imported-topdown.png"
const SOURCE_N := 65
const IMPORT_N := 257
const REGION_N := 256
const WATER_CEILING := -2.5

func _initialize() -> void: call_deferred("_run")
func fail(message:String) -> void: push_error("G17 Terrain3D relief proof failed: "+message); quit(1)
func need(ok:bool,message:String)->bool:
	if not ok: fail(message); return false
	return true

func source_h(p:Dictionary,u:float,v:float)->float:
	var rows:Array=p.rows; var gx:=clampf(u,0,1)*64.0; var gy:=clampf(v,0,1)*64.0
	var x0:=int(floor(gx)); var y0:=int(floor(gy)); var x1:=mini(x0+1,64); var y1:=mini(y0+1,64)
	return lerpf(lerpf(float(rows[y0][x0]),float(rows[y0][x1]),gx-x0),lerpf(float(rows[y1][x0]),float(rows[y1][x1]),gx-x0),gy-y0)

func height_image(p:Dictionary)->Image:
	var image:=Image.create_empty(IMPORT_N,IMPORT_N,false,Image.FORMAT_RF)
	for z in IMPORT_N:
		for x in IMPORT_N: image.set_pixel(x,z,Color(source_h(p,float(x)/256.0,float(z)/256.0),0,0,1))
	return image

func saved_evidence(directory:String)->Dictionary:
	var d:=DirAccess.open(directory); if d==null: return {}
	var files:=0; var bytes:=0; d.list_dir_begin(); var n:=d.get_next()
	while n!="":
		if not d.current_is_dir(): files+=1; bytes+=FileAccess.get_file_as_bytes(directory.path_join(n)).size()
		n=d.get_next()
	d.list_dir_end(); return {"files":files,"bytes":bytes}

func write_preview(t:Terrain3D,min_h:float,max_h:float)->bool:
	var image:=Image.create_empty(256,256,false,Image.FORMAT_RGB8); var span:=maxf(max_h-min_h,0.0001)
	for z in 256:
		for x in 256:
			var h:=t.data.get_height(Vector3(x,0,z)); if is_nan(h): return false
			image.set_pixel(x,z,Color(0.03,0.09,0.12).lerp(Color(0.22,0.42,0.48),clampf((h-min_h)/span,0,1)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(PREVIEW).get_base_dir()); return image.save_png(PREVIEW)==OK

func _run()->void:
	if not need(FileAccess.file_exists(PROBE),"probe missing"): return
	var p=JSON.parse_string(FileAccess.get_file_as_string(PROBE)); if not need(p is Dictionary,"probe invalid"): return
	if not need(String(p.policyId)=="gunbatimi-ustasi-g17-terrain3d-relief-2026-08-13-v1","policy changed"): return
	if not need(String(p.sourceMapSha256)=="20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1","map SHA changed"): return
	if not need(int(p.sourceGridSize)==SOURCE_N and int(p.terrain3dImportSize)==IMPORT_N and int(p.terrain3dRegionSize)==REGION_N,"proof dimensions changed"): return
	if not need(int(p.canonicalWaterCells)==96 and int(p.canonicalLandCells)==0 and float(p.maxHeight)<WATER_CEILING,"marine contract changed"): return
	var t:=Terrain3D.new(); get_root().add_child(t); t.region_size=REGION_N
	if not need(String(t.version).begins_with("1.0.2"),"pinned Terrain3D did not load"): return
	t.data.import_images([height_image(p),null,null],Vector3.ZERO,0.0,1.0)
	if not need(t.data.get_region_count()>=4,"257 import must create >=4 regions"): return
	var max_aligned:=0.0; var min_h:=INF; var max_h:=-INF; var checksum:int=2166136261; var aligned:=0
	for sy in SOURCE_N:
		for sx in SOURCE_N:
			var actual:=t.data.get_height(Vector3(sx*4,0,sy*4)); var expected:=source_h(p,float(sx)/64.0,float(sy)/64.0)
			if is_nan(actual): fail("NaN aligned height"); return
			max_aligned=maxf(max_aligned,absf(actual-expected)); min_h=minf(min_h,actual); max_h=maxf(max_h,actual); checksum=int((checksum^int(round((actual+32.0)*1000.0)))*16777619)&0xffffffff; aligned+=1
	if not need(max_aligned<=0.012 and max_h< WATER_CEILING and max_h>min_h,"height roundtrip failed"): return
	var seam:=[254.5,255.0,255.5,256.0]; var max_seam:=0.0; var seam_n:=0
	for x in seam:
		for z in [32.25,96.5,160.75,224.5,254.5,255.0,255.5,256.0]:
			for point in [Vector2(float(x),float(z)),Vector2(float(z),float(x))]:
				var a:=t.data.get_height(Vector3(point.x,0,point.y)); var e:=source_h(p,point.x/256.0,point.y/256.0)
				if is_nan(a): fail("NaN seam height"); return
				max_seam=maxf(max_seam,absf(a-e)); seam_n+=1
	if not need(max_seam<=0.02,"255/256 seam failed"): return
	var mesh:Mesh=t.bake_mesh(0); if not need(mesh!=null and mesh.get_surface_count()>0,"LOD0 bake empty"): return
	var vertices:PackedVector3Array=mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]; if not need(vertices.size()>0,"LOD0 vertices empty"): return
	var suffix:=OS.get_environment("G17_RELIEF_PROOF_SUFFIX"); if suffix.is_empty(): suffix="default"
	var out:="user://g17-relief-"+suffix; DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(out)); t.data.save_directory(out)
	var saved:=saved_evidence(out); if not need(int(saved.files)>=4 and int(saved.bytes)>0,"region persistence failed"): return
	if not need(write_preview(t,float(p.minHeight),float(p.maxHeight)),"preview failed"): return
	var m={"terrain3dVersion":String(t.version),"regionCount":t.data.get_region_count(),"alignedSamples":aligned,"seamSamples":seam_n,"maxAlignedHeightError":snappedf(max_aligned,0.00000001),"maxSeamHeightError":snappedf(max_seam,0.00000001),"minImportedHeight":snappedf(min_h,0.000001),"maxImportedHeight":snappedf(max_h,0.000001),"outputChecksum":checksum,"bakedSurfaces":mesh.get_surface_count(),"bakedVertices":vertices.size(),"savedRegionFiles":saved.files,"savedRegionBytes":saved.bytes}
	print("G17_TERRAIN3D_RELIEF_METRICS="+JSON.stringify(m)); print("SW_G17_TERRAIN3D_RELIEF_VALIDATION_OK"); quit(0)
