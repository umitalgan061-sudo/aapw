extends SceneTree

const RELIEF_PROBE := "res://.terrain3d-proof/g77-relief-probe.json"
const BIOME_PROBE := "res://.terrain3d-proof/g77-biome-probe.json"
const POLICY := "kizil-ufuk-g77-terrain3d-relief-2026-08-13-v1"
const MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SIZE := 257
const SOURCE_SIZE := 65
const REGION_SIZE := 256

func _initialize() -> void: call_deferred("_run")
func _fail(message:String)->void: push_error("G77 relief proof failed: "+message); quit(1)
func _need(ok:bool,message:String)->bool:
	if not ok: _fail(message); return false
	return true

func _scalar(probe:Dictionary,u:float,v:float)->float:
	var rows:Array=probe["rows"]; var gx:=clampf(u,0,1)*64.0; var gy:=clampf(v,0,1)*64.0
	var x0:=int(floor(gx)); var y0:=int(floor(gy)); var x1:=mini(x0+1,64); var y1:=mini(y0+1,64); var tx:=gx-x0; var ty:=gy-y0
	return lerpf(lerpf(float(rows[y0][x0]),float(rows[y0][x1]),tx),lerpf(float(rows[y1][x0]),float(rows[y1][x1]),tx),ty)

func _channel(probe:Dictionary,channel:int,u:float,v:float)->float:
	var rows:Array=probe["rows"]; var gx:=clampf(u,0,1)*64.0; var gy:=clampf(v,0,1)*64.0
	var x0:=int(floor(gx)); var y0:=int(floor(gy)); var x1:=mini(x0+1,64); var y1:=mini(y0+1,64); var tx:=gx-x0; var ty:=gy-y0
	return lerpf(lerpf(float(rows[y0][x0][channel]),float(rows[y0][x1][channel]),tx),lerpf(float(rows[y1][x0][channel]),float(rows[y1][x1][channel]),tx),ty)

func _images(relief:Dictionary,biome:Dictionary)->Array:
	var height:=Image.create_empty(SIZE,SIZE,false,Image.FORMAT_RF)
	var control:=Image.create_empty(SIZE,SIZE,false,Image.FORMAT_RF)
	var color:=Image.create_empty(SIZE,SIZE,false,Image.FORMAT_RGBA8)
	for z in SIZE:
		for x in SIZE:
			var u:=x/256.0; var v:=z/256.0; var blend:=int(round(clampf(_channel(biome,0,u,v),0,1)*255.0))
			var bits:int=Terrain3DUtil.enc_base(0)|Terrain3DUtil.enc_overlay(1)|Terrain3DUtil.enc_blend(blend)
			height.set_pixel(x,z,Color(_scalar(relief,u,v),0,0,1))
			control.set_pixel(x,z,Color(Terrain3DUtil.as_float(bits),0,0,1))
			color.set_pixel(x,z,Color(_channel(biome,2,u,v),_channel(biome,3,u,v),_channel(biome,4,u,v),_channel(biome,5,u,v)))
	return [height,control,color]

func _saved_evidence(directory:String)->Dictionary:
	var dir:=DirAccess.open(directory); if dir==null: return {"files":0,"bytes":0}
	var files:=0; var bytes:=0; dir.list_dir_begin(); var name:=dir.get_next()
	while name!="":
		if not dir.current_is_dir(): files+=1; bytes+=FileAccess.get_file_as_bytes(directory.path_join(name)).size()
		name=dir.get_next()
	dir.list_dir_end(); return {"files":files,"bytes":bytes}

func _preview(terrain:Terrain3D,suffix:String,min_h:float,max_h:float)->bool:
	var out:=Image.create_empty(SIZE,SIZE,false,Image.FORMAT_RGBA8); var span:=maxf(max_h-min_h,0.001)
	for z in SIZE:
		for x in SIZE:
			var point:=Vector3(x,0,z); var height:=terrain.data.get_height(point); var color:=terrain.data.get_color(point)
			if is_nan(height) or is_nan(color.r): return false
			var shade:=0.72+0.28*clampf((height-min_h)/span,0,1); out.set_pixel(x,z,Color(color.r*shade,color.g*shade,color.b*shade,1))
	return out.save_png("res://.terrain3d-proof/g77-relief-imported-topdown-"+suffix+".png")==OK

func _run()->void:
	if not _need(FileAccess.file_exists(RELIEF_PROBE) and FileAccess.file_exists(BIOME_PROBE),"probe missing"): return
	var rr=JSON.parse_string(FileAccess.get_file_as_string(RELIEF_PROBE)); var bb=JSON.parse_string(FileAccess.get_file_as_string(BIOME_PROBE))
	if not _need(rr is Dictionary and bb is Dictionary,"probe invalid"): return
	var relief:Dictionary=rr; var biome:Dictionary=bb
	if not _need(String(relief.get("policyId",""))==POLICY and String(relief.get("sourceMapSha256",""))==MAP_SHA,"relief provenance changed"): return
	if not _need(int(relief.get("canonicalWater",0))==44 and int(relief.get("canonicalLand",0))==52 and int(relief.get("canonicalSignMismatches",1))==0,"G77 coastline semantics changed"): return
	if not _need(int(relief.get("sourceGridSize",0))==SOURCE_SIZE and int(relief.get("terrain3dImportSize",0))==SIZE and int(relief.get("terrain3dRegionSize",0))==REGION_SIZE,"import contract changed"): return
	var images:=_images(relief,biome); var terrain:=Terrain3D.new(); get_root().add_child(terrain); terrain.region_size=REGION_SIZE
	if not _need(String(terrain.version).begins_with("1.0.2"),"Terrain3D pin not loaded"): return
	terrain.data.import_images([images[0],images[1],images[2]],Vector3.ZERO,0,1)
	if not _need(terrain.data.get_region_count()>=4,"257 import did not create four regions"): return
	var max_h:=0.0; var max_blend:=0.0; var max_color:=0.0; var max_roughness:=0.0; var min_h:=INF; var max_imported:=-INF; var aligned:=0; var checksum:int=2166136261
	for y in SOURCE_SIZE:
		for x in SOURCE_SIZE:
			var u:=x/64.0; var v:=y/64.0; var point:=Vector3(x*4,0,y*4); var height:=terrain.data.get_height(point); var color:=terrain.data.get_color(point); var roughness:=terrain.data.get_roughness(point)
			if not _need(not is_nan(height) and not is_nan(color.r) and not is_nan(roughness),"aligned NaN"): return
			max_h=maxf(max_h,absf(height-_scalar(relief,u,v))); max_blend=maxf(max_blend,absf(terrain.data.get_control_blend(point)-_channel(biome,0,u,v)))
			max_color=maxf(max_color,maxf(absf(color.r-_channel(biome,2,u,v)),maxf(absf(color.g-_channel(biome,3,u,v)),absf(color.b-_channel(biome,4,u,v)))))
			max_roughness=maxf(max_roughness,absf(roughness-_channel(biome,5,u,v))); min_h=minf(min_h,height); max_imported=maxf(max_imported,height); aligned+=1
			checksum=int((checksum^int(round((height+128.0)*1000.0)))*16777619)&0xffffffff
	if not _need(max_h<=0.012 and max_blend<=0.006 and max_color<=0.012 and max_roughness<=0.012,"roundtrip tolerance exceeded"): return
	var seams:=0; var max_seam_h:=0.0
	for edge in [254.75,255.0,255.25,255.5,255.75,256.0]:
		for cross in [64.5,128.5,192.5,255.5]:
			for point in [Vector3(edge,0,cross),Vector3(cross,0,edge)]:
				var actual:=terrain.data.get_height(point); if not _need(not is_nan(actual) and not is_nan(terrain.data.get_control_blend(point)) and not is_nan(terrain.data.get_color(point).r),"255/256 seam NaN"): return
				max_seam_h=maxf(max_seam_h,absf(actual-_scalar(relief,point.x/256.0,point.z/256.0))); seams+=1
	if not _need(max_seam_h<=0.02,"255/256 height seam exceeded tolerance"): return
	var mesh:Mesh=terrain.bake_mesh(0); if not _need(mesh!=null and mesh.get_surface_count()>0,"LOD0 empty"): return
	var vertices:PackedVector3Array=mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]; if not _need(not vertices.is_empty(),"LOD0 vertices empty"): return
	var suffix:=OS.get_environment("G77_RELIEF_PROOF_SUFFIX"); if suffix.is_empty(): suffix="default"
	var directory:="user://g77-relief-"+suffix; DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(directory)); terrain.data.save_directory(directory)
	var saved:=_saved_evidence(directory); if not _need(int(saved["files"])>=4 and int(saved["bytes"])>0,"persisted region evidence empty"): return
	if not _need(_preview(terrain,suffix,float(relief["minHeight"]),float(relief["maxHeight"])),"preview failed"): return
	var metrics={"terrain3dVersion":String(terrain.version),"regionCount":terrain.data.get_region_count(),"alignedSamples":aligned,"seamSamples":seams,"maxHeightError":snappedf(max_h,0.00000001),"maxSeamHeightError":snappedf(max_seam_h,0.00000001),"maxBlendError":snappedf(max_blend,0.00000001),"maxColorError":snappedf(max_color,0.00000001),"maxRoughnessError":snappedf(max_roughness,0.00000001),"minImportedHeight":snappedf(min_h,0.000001),"maxImportedHeight":snappedf(max_imported,0.000001),"heightChecksum":checksum,"bakedSurfaces":mesh.get_surface_count(),"bakedVertices":vertices.size(),"savedRegionFiles":saved["files"],"savedRegionBytes":saved["bytes"]}
	print("G77_TERRAIN3D_RELIEF_METRICS="+JSON.stringify(metrics)); print("SE_G77_TERRAIN3D_RELIEF_VALIDATION_OK"); quit(0)
