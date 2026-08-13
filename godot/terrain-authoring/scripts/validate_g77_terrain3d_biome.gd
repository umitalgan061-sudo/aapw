extends SceneTree

const PROBE := "res://.terrain3d-proof/g77-biome-probe.json"
const POLICY := "kizil-ufuk-g77-terrain3d-biome-2026-08-13-v1"
const MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SIZE := 257

func _initialize() -> void: call_deferred("_run")
func _fail(m:String)->void: push_error("G77 biome proof failed: "+m); quit(1)
func _need(ok:bool,m:String)->bool:
	if not ok: _fail(m); return false
	return true
func _v(p:Dictionary,ch:int,u:float,v:float)->float:
	var r:Array=p["rows"]; var gx:=clampf(u,0,1)*64.0; var gy:=clampf(v,0,1)*64.0
	var x0:=int(floor(gx)); var y0:=int(floor(gy)); var x1:=mini(x0+1,64); var y1:=mini(y0+1,64); var tx:=gx-x0; var ty:=gy-y0
	return lerpf(lerpf(float(r[y0][x0][ch]),float(r[y0][x1][ch]),tx),lerpf(float(r[y1][x0][ch]),float(r[y1][x1][ch]),tx),ty)
func _images(p:Dictionary)->Array:
	var h:=Image.create_empty(SIZE,SIZE,false,Image.FORMAT_RF); var c:=Image.create_empty(SIZE,SIZE,false,Image.FORMAT_RGBA8)
	for z in SIZE:
		for x in SIZE:
			var u:=x/256.0; var v:=z/256.0; h.set_pixel(x,z,Color(_v(p,1,u,v),0,0,1)); c.set_pixel(x,z,Color(_v(p,2,u,v),_v(p,3,u,v),_v(p,4,u,v),_v(p,5,u,v)))
	return [h,c]
func _preview(t:Terrain3D,suffix:String)->bool:
	var out:=Image.create_empty(SIZE,SIZE,false,Image.FORMAT_RGBA8)
	for z in SIZE:
		for x in SIZE:
			var c:=t.data.get_color(Vector3(x,0,z)); if is_nan(c.r): return false
			out.set_pixel(x,z,Color(c.r,c.g,c.b,1))
	return out.save_png("res://.terrain3d-proof/g77-biome-imported-topdown-"+suffix+".png")==OK
func _run()->void:
	if not _need(FileAccess.file_exists(PROBE),"probe missing"): return
	var q=JSON.parse_string(FileAccess.get_file_as_string(PROBE)); if not _need(q is Dictionary,"probe invalid"): return
	var p:Dictionary=q
	if not _need(String(p.get("policyId",""))==POLICY and String(p.get("sourceMapSha256",""))==MAP_SHA,"provenance changed"): return
	if not _need(int(p.get("sourceGridSize",0))==65 and int(p.get("terrain3dImportSize",0))==SIZE,"size changed"): return
	var imgs:=_images(p); var t:=Terrain3D.new(); get_root().add_child(t); t.region_size=256
	if not _need(String(t.version).begins_with("1.0.2"),"Terrain3D pin not loaded"): return
	t.data.import_images([imgs[0],null,imgs[1]],Vector3.ZERO,0,1)
	if not _need(t.data.get_region_count()>=4,"257 import did not create four regions"): return
	var max_h:=0.0; var max_c:=0.0; var aligned:=0
	for y in 65:
		for x in 65:
			var u:=x/64.0; var v:=y/64.0; var pos:=Vector3(x*4,0,y*4); var h:=t.data.get_height(pos); var c:=t.data.get_color(pos)
			if not _need(not is_nan(h) and not is_nan(c.r),"aligned NaN"): return
			max_h=maxf(max_h,absf(h-_v(p,1,u,v))); max_c=maxf(max_c,maxf(absf(c.r-_v(p,2,u,v)),maxf(absf(c.g-_v(p,3,u,v)),absf(c.b-_v(p,4,u,v))))); aligned+=1
	if not _need(max_h<=0.012 and max_c<=0.012,"roundtrip tolerance exceeded"): return
	var seams:=0
	for s in [254.75,255.0,255.25,255.5,255.75,256.0]:
		for cross in [64.5,128.5,192.5,255.5]:
			for pos in [Vector3(s,0,cross),Vector3(cross,0,s)]:
				if not _need(not is_nan(t.data.get_height(pos)) and not is_nan(t.data.get_color(pos).r),"255/256 seam NaN"): return
				seams+=1
	var mesh:Mesh=t.bake_mesh(0); if not _need(mesh!=null and mesh.get_surface_count()>0,"LOD0 empty"): return
	var suffix:=OS.get_environment("G77_BIOME_PROOF_SUFFIX"); if suffix.is_empty(): suffix="default"
	var directory:="user://g77-biome-"+suffix; DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(directory)); t.data.save_directory(directory)
	if not _need(_preview(t,suffix),"preview failed"): return
	print("G77_TERRAIN3D_BIOME_METRICS="+JSON.stringify({"regions":t.data.get_region_count(),"alignedSamples":aligned,"seamSamples":seams,"maxHeightError":max_h,"maxColorError":max_c,"bakedSurfaces":mesh.get_surface_count()})); print("SE_G77_TERRAIN3D_BIOME_VALIDATION_OK"); quit(0)
