extends SceneTree

const RELIEF_PROBE := "res://.terrain3d-proof/g77-relief-probe.json"
const BIOME_PROBE := "res://.terrain3d-proof/g77-biome-probe.json"
const POLICY := "kizil-ufuk-g77-terrain3d-relief-2026-08-13-v1"
const MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SIZE := 257

func _initialize() -> void: call_deferred("_run")
func _fail(m:String)->void: push_error("G77 relief proof failed: "+m); quit(1)
func _need(ok:bool,m:String)->bool:
	if not ok: _fail(m); return false
	return true

func _scalar(p:Dictionary,u:float,v:float)->float:
	var r:Array=p["rows"]; var gx:=clampf(u,0,1)*64.0; var gy:=clampf(v,0,1)*64.0
	var x0:=int(floor(gx)); var y0:=int(floor(gy)); var x1:=mini(x0+1,64); var y1:=mini(y0+1,64); var tx:=gx-x0; var ty:=gy-y0
	return lerpf(lerpf(float(r[y0][x0]),float(r[y0][x1]),tx),lerpf(float(r[y1][x0]),float(r[y1][x1]),tx),ty)
func _channel(p:Dictionary,ch:int,u:float,v:float)->float:
	var r:Array=p["rows"]; var gx:=clampf(u,0,1)*64.0; var gy:=clampf(v,0,1)*64.0
	var x0:=int(floor(gx)); var y0:=int(floor(gy)); var x1:=mini(x0+1,64); var y1:=mini(y0+1,64); var tx:=gx-x0; var ty:=gy-y0
	return lerpf(lerpf(float(r[y0][x0][ch]),float(r[y0][x1][ch]),tx),lerpf(float(r[y1][x0][ch]),float(r[y1][x1][ch]),tx),ty)
func _images(relief:Dictionary,biome:Dictionary)->Array:
	var h:=Image.create_empty(SIZE,SIZE,false,Image.FORMAT_RF); var ctl:=Image.create_empty(SIZE,SIZE,false,Image.FORMAT_RF); var col:=Image.create_empty(SIZE,SIZE,false,Image.FORMAT_RGBA8)
	for z in SIZE:
		for x in SIZE:
			var u:=x/256.0; var v:=z/256.0; var blend:=int(round(clampf(_channel(biome,0,u,v),0,1)*255.0))
			var bits:int=Terrain3DUtil.enc_base(0)|Terrain3DUtil.enc_overlay(1)|Terrain3DUtil.enc_blend(blend)
			h.set_pixel(x,z,Color(_scalar(relief,u,v),0,0,1)); ctl.set_pixel(x,z,Color(Terrain3DUtil.as_float(bits),0,0,1)); col.set_pixel(x,z,Color(_channel(biome,2,u,v),_channel(biome,3,u,v),_channel(biome,4,u,v),_channel(biome,5,u,v)))
	return [h,ctl,col]
func _preview(t:Terrain3D,suffix:String,min_h:float,max_h:float)->bool:
	var out:=Image.create_empty(SIZE,SIZE,false,Image.FORMAT_RGBA8); var span:=maxf(max_h-min_h,0.001)
	for z in SIZE:
		for x in SIZE:
			var p:=Vector3(x,0,z); var h:=t.data.get_height(p); var c:=t.data.get_color(p)
			if is_nan(h) or is_nan(c.r): return false
			var shade:=0.72+0.28*clampf((h-min_h)/span,0,1); out.set_pixel(x,z,Color(c.r*shade,c.g*shade,c.b*shade,1))
	return out.save_png("res://.terrain3d-proof/g77-relief-imported-topdown-"+suffix+".png")==OK

func _run()->void:
	if not _need(FileAccess.file_exists(RELIEF_PROBE) and FileAccess.file_exists(BIOME_PROBE),"probe missing"): return
	var rr=JSON.parse_string(FileAccess.get_file_as_string(RELIEF_PROBE)); var bb=JSON.parse_string(FileAccess.get_file_as_string(BIOME_PROBE))
	if not _need(rr is Dictionary and bb is Dictionary,"probe invalid"): return
	var relief:Dictionary=rr; var biome:Dictionary=bb
	if not _need(String(relief.get("policyId",""))==POLICY and String(relief.get("sourceMapSha256",""))==MAP_SHA,"relief provenance changed"): return
	if not _need(int(relief.get("canonicalWater",0))==44 and int(relief.get("canonicalLand",0))==52 and int(relief.get("canonicalSignMismatches",1))==0,"G77 coastline semantics changed"): return
	if not _need(int(relief.get("terrain3dImportSize",0))==SIZE and int(relief.get("terrain3dRegionSize",0))==256,"import contract changed"): return
	var imgs:=_images(relief,biome); var t:=Terrain3D.new(); get_root().add_child(t); t.region_size=256
	if not _need(String(t.version).begins_with("1.0.2"),"Terrain3D pin not loaded"): return
	t.data.import_images([imgs[0],imgs[1],imgs[2]],Vector3.ZERO,0,1)
	if not _need(t.data.get_region_count()>=4,"257 import did not create four regions"): return
	var max_h:=0.0; var max_blend:=0.0; var max_color:=0.0; var aligned:=0
	for y in 65:
		for x in 65:
			var u:=x/64.0; var v:=y/64.0; var p:=Vector3(x*4,0,y*4); var h:=t.data.get_height(p); var c:=t.data.get_color(p)
			if not _need(not is_nan(h) and not is_nan(c.r),"aligned NaN"): return
			max_h=maxf(max_h,absf(h-_scalar(relief,u,v))); max_blend=maxf(max_blend,absf(t.data.get_control_blend(p)-_channel(biome,0,u,v)))
			max_color=maxf(max_color,maxf(absf(c.r-_channel(biome,2,u,v)),maxf(absf(c.g-_channel(biome,3,u,v)),absf(c.b-_channel(biome,4,u,v))))); aligned+=1
	if not _need(max_h<=0.012 and max_blend<=0.006 and max_color<=0.012,"roundtrip tolerance exceeded"): return
	var seams:=0
	for s in [254.75,255.0,255.25,255.5,255.75,256.0]:
		for cross in [64.5,128.5,192.5,255.5]:
			for p in [Vector3(s,0,cross),Vector3(cross,0,s)]:
				if not _need(not is_nan(t.data.get_height(p)) and not is_nan(t.data.get_control_blend(p)) and not is_nan(t.data.get_color(p).r),"255/256 seam NaN"): return
				seams+=1
	var mesh:Mesh=t.bake_mesh(0); if not _need(mesh!=null and mesh.get_surface_count()>0,"LOD0 empty"): return
	var vertices:PackedVector3Array=mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]; if not _need(not vertices.is_empty(),"LOD0 vertices empty"): return
	var suffix:=OS.get_environment("G77_RELIEF_PROOF_SUFFIX"); if suffix.is_empty(): suffix="default"
	var directory:="user://g77-relief-"+suffix; DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(directory)); t.data.save_directory(directory)
	if not _need(_preview(t,suffix,float(relief["minHeight"]),float(relief["maxHeight"])),"preview failed"): return
	print("G77_TERRAIN3D_RELIEF_METRICS="+JSON.stringify({"regions":t.data.get_region_count(),"alignedSamples":aligned,"seamSamples":seams,"maxHeightError":max_h,"maxBlendError":max_blend,"maxColorError":max_color,"bakedVertices":vertices.size()})); print("SE_G77_TERRAIN3D_RELIEF_VALIDATION_OK"); quit(0)
