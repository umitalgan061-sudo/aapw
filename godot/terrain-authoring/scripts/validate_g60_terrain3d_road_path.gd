extends SceneTree

const PROBE_PATH := "res://.terrain3d-proof/g60-road-path-probe.json"
const METRICS_PATH := "res://.terrain3d-proof/g60-road-path-bake.json"
const PREVIEW_PATH := "res://.terrain3d-proof/g60-road-path-imported-topdown.png"
const EXPECTED_SCHEMA := "westeros-g60-terrain3d-road-path-probe-v1"
const EXPECTED_POLICY := "safak-kartali-g60-terrain3d-road-path-2026-08-15-v1"
const EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"
const SOURCE_SIZE := 65
const IMPORT_SIZE := 257
const REGION_SIZE := 256
const HEIGHT_TOLERANCE := 0.001
const MATERIAL_TOLERANCE := 0.006
const BLEND_TOLERANCE := 0.000001

func _initialize() -> void: call_deferred("_run")
func _fail(message:String)->void: push_error("G60 Terrain3D Road/Path proof failed: "+message); quit(1)
func _require(ok:bool,message:String)->bool:
	if not ok: _fail(message); return false
	return true

func _source_value(probe:Dictionary, channel:int, u:float, v:float)->float:
	var rows:Array=probe["rows"]; var gx:=clampf(u,0,1)*64.0; var gy:=clampf(v,0,1)*64.0
	var x0:=int(floor(gx)); var y0:=int(floor(gy)); var x1:=mini(x0+1,64); var y1:=mini(y0+1,64)
	var tx:=gx-float(x0); var ty:=gy-float(y0)
	return lerpf(lerpf(float(rows[y0][x0][channel]),float(rows[y0][x1][channel]),tx),lerpf(float(rows[y1][x0][channel]),float(rows[y1][x1][channel]),tx),ty)

func _height_image(probe:Dictionary)->Image:
	var image:=Image.create_empty(IMPORT_SIZE,IMPORT_SIZE,false,Image.FORMAT_RF)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE: image.set_pixel(x,z,Color(_source_value(probe,0,float(x)/256.0,float(z)/256.0),0,0,1))
	return image

func _control_image(probe:Dictionary)->Image:
	var image:=Image.create_empty(IMPORT_SIZE,IMPORT_SIZE,false,Image.FORMAT_RF)
	var base_id:=int(probe["baseTextureId"]); var overlay_id:=int(probe["substrateOverlayTextureId"])
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var blend:=int(round(clampf(_source_value(probe,3,float(x)/256.0,float(z)/256.0),0,1)*255.0))
			var bits:int=Terrain3DUtil.enc_base(base_id)|Terrain3DUtil.enc_overlay(overlay_id)|Terrain3DUtil.enc_blend(blend)
			image.set_pixel(x,z,Color(Terrain3DUtil.as_float(bits),0,0,1))
	return image

func _color_image(probe:Dictionary)->Image:
	var image:=Image.create_empty(IMPORT_SIZE,IMPORT_SIZE,false,Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var u:=float(x)/256.0; var v:=float(z)/256.0
			image.set_pixel(x,z,Color(_source_value(probe,5,u,v),_source_value(probe,6,u,v),_source_value(probe,7,u,v),_source_value(probe,8,u,v)))
	return image

func _saved(directory:String)->Dictionary:
	var dir:=DirAccess.open(directory)
	if dir==null:return {"files":[],"bytes":0}
	var files:Array[String]=[]; var bytes:=0; dir.list_dir_begin(); var name:=dir.get_next()
	while name!="":
		if not dir.current_is_dir():
			var data:=FileAccess.get_file_as_bytes(directory.path_join(name))
			if data.size()>0: files.push_back(name); bytes+=data.size()
		name=dir.get_next()
	dir.list_dir_end(); files.sort(); return {"files":files,"bytes":bytes}

func _write_preview(terrain:Terrain3D)->Error:
	var image:=Image.create_empty(IMPORT_SIZE,IMPORT_SIZE,false,Image.FORMAT_RGBA8)
	for z in IMPORT_SIZE:
		for x in IMPORT_SIZE:
			var pos:=Vector3(float(x),0,float(z)); var color:=terrain.data.get_color(pos); var rough:=terrain.data.get_roughness(pos); var blend:=terrain.data.get_control_blend(pos)
			if is_nan(color.r) or is_nan(color.g) or is_nan(color.b) or is_nan(rough) or is_nan(blend): return ERR_INVALID_DATA
			image.set_pixel(x,z,Color(color.r,color.g,color.b,clampf(rough,0,1)))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof")); return image.save_png(PREVIEW_PATH)

func _run()->void:
	if not _require(FileAccess.file_exists(PROBE_PATH),"probe JSON missing"):return
	var parsed=JSON.parse_string(FileAccess.get_file_as_string(PROBE_PATH))
	if not _require(parsed is Dictionary,"probe JSON invalid"):return
	var probe:Dictionary=parsed
	if not _require(String(probe.get("schema",""))==EXPECTED_SCHEMA,"schema drifted"):return
	if not _require(String(probe.get("policyId",""))==EXPECTED_POLICY,"policy drifted"):return
	if not _require(String(probe.get("sourceMapSha256",""))==EXPECTED_MAP_SHA,"map provenance drifted"):return
	if not _require(String(probe.get("geoCell",""))=="G60" and String(probe.get("layer",""))=="Road/Path","cell/layer drifted"):return
	if not _require(int(probe.get("sourceGridSize",0))==SOURCE_SIZE and int(probe.get("terrain3dImportSize",0))==IMPORT_SIZE and int(probe.get("terrain3dRegionSize",0))==REGION_SIZE,"source/import contract drifted"):return
	if not _require((probe.get("crossingEdges",[]) as Array).size()==0,"live route entered G60 guard"):return
	if not _require(int(probe["roadTextureId"])==2 and int(probe["pathTextureId"])==3,"road/path IDs drifted"):return
	for row in probe["rows"]:
		if not _require(row is Array and (row as Array).size()==SOURCE_SIZE,"invalid row width"):return
		for sample in row:
			if not _require(sample is Array and (sample as Array).size()==9,"invalid channel count"):return
			if not _require(absf(float(sample[0])+8.0)<=0.00000001,"Road/Path changed Relief height"):return
			if not _require(absf(float(sample[1]))<=BLEND_TOLERANCE and absf(float(sample[2]))<=BLEND_TOLERANCE and absf(float(sample[3]))<=BLEND_TOLERANCE and int(sample[4])==0,"source invented route/control"):return

	var terrain:=Terrain3D.new(); terrain.name="G60Terrain3DRoadPathProof"; get_root().add_child(terrain); terrain.region_size=REGION_SIZE
	if not _require(String(terrain.version).begins_with("1.0.2"),"pinned Terrain3D v1.0.2 did not load"):return
	terrain.data.import_images([_height_image(probe),_control_image(probe),_color_image(probe)],Vector3.ZERO,0.0,1.0)
	var regions:=terrain.data.get_region_count()
	if not _require(regions>=4,"257x257 Height+Control+Color did not create >=4 regions"):return
	var base_id:=int(probe["baseTextureId"]); var substrate_overlay:=int(probe["substrateOverlayTextureId"]); var road_id:=int(probe["roadTextureId"]); var path_id:=int(probe["pathTextureId"])
	var max_height:=0.0; var max_blend:=0.0; var max_color:=0.0; var max_rough:=0.0; var aligned:=0; var forbidden_overlay_samples:=0
	for sy in SOURCE_SIZE:
		for sx in SOURCE_SIZE:
			var u:=float(sx)/64.0; var v:=float(sy)/64.0; var pos:=Vector3(float(sx*4),0,float(sy*4))
			var height:=terrain.data.get_height(pos); var color:=terrain.data.get_color(pos); var rough:=terrain.data.get_roughness(pos); var blend:=terrain.data.get_control_blend(pos)
			if not _require(not is_nan(height) and not is_nan(color.r) and not is_nan(rough) and not is_nan(blend),"invalid aligned Terrain3D data"):return
			var actual_base:=terrain.data.get_control_base_id(pos); var actual_overlay:=terrain.data.get_control_overlay_id(pos)
			if actual_overlay==road_id or actual_overlay==path_id: forbidden_overlay_samples+=1
			if not _require(actual_base==base_id and actual_overlay==substrate_overlay,"substrate control IDs changed"):return
			max_height=maxf(max_height,absf(height-_source_value(probe,0,u,v))); max_blend=maxf(max_blend,absf(blend-_source_value(probe,3,u,v)))
			max_color=maxf(max_color,maxf(absf(color.r-_source_value(probe,5,u,v)),maxf(absf(color.g-_source_value(probe,6,u,v)),absf(color.b-_source_value(probe,7,u,v)))))
			max_rough=maxf(max_rough,absf(rough-_source_value(probe,8,u,v))); aligned+=1
	if not _require(aligned==4225 and forbidden_overlay_samples==0,"aligned/forbidden overlay audit failed"):return
	if not _require(max_height<=HEIGHT_TOLERANCE and max_blend<=BLEND_TOLERANCE,"height/control roundtrip failed"):return
	if not _require(max_color<=MATERIAL_TOLERANCE and max_rough<=MATERIAL_TOLERANCE,"material roundtrip failed"):return

	var seam_axis:=[254.75,255.0,255.25,255.5,255.75,256.0]; var cross_axis:=[32.25,96.5,160.75,224.5,256.0]
	var seam_samples:=0; var max_seam_height:=0.0; var max_seam_blend:=0.0; var max_seam_material:=0.0
	for edge in seam_axis:
		for cross in cross_axis:
			for raw_pos in [Vector3(float(edge),0.0,float(cross)),Vector3(float(cross),0.0,float(edge))]:
				var pos:Vector3=raw_pos; var u:float=pos.x/256.0; var v:float=pos.z/256.0
				var height:=terrain.data.get_height(pos); var color:=terrain.data.get_color(pos); var rough:=terrain.data.get_roughness(pos); var blend:=terrain.data.get_control_blend(pos)
				if not _require(not is_nan(height) and not is_nan(color.r) and not is_nan(rough) and not is_nan(blend),"invalid seam data"):return
				max_seam_height=maxf(max_seam_height,absf(height-_source_value(probe,0,u,v))); max_seam_blend=maxf(max_seam_blend,absf(blend))
				max_seam_material=maxf(max_seam_material,maxf(absf(color.r-_source_value(probe,5,u,v)),maxf(absf(color.g-_source_value(probe,6,u,v)),maxf(absf(color.b-_source_value(probe,7,u,v)),absf(rough-_source_value(probe,8,u,v)))))); seam_samples+=1
	if not _require(seam_samples==60 and max_seam_height<=HEIGHT_TOLERANCE and max_seam_blend<=BLEND_TOLERANCE and max_seam_material<=MATERIAL_TOLERANCE,"255/256 seam drifted"):return

	var mesh:Mesh=terrain.bake_mesh(0)
	if not _require(mesh!=null and mesh.get_surface_count()>0,"LOD0 bake empty"):return
	var vertices:PackedVector3Array=mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	if not _require(vertices.size()>0,"LOD0 vertices empty"):return
	var suffix:=OS.get_environment("G60_ROAD_PATH_PROOF_SUFFIX"); if suffix.is_empty(): suffix="default"
	var out_dir:="user://g60-terrain3d-road-path-"+suffix; DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(out_dir)); terrain.data.save_directory(out_dir)
	var saved:=_saved(out_dir)
	if not _require(saved["files"].size()>=4 and int(saved["bytes"])>0,"region persistence failed"):return
	if not _require(_write_preview(terrain)==OK,"preview failed"):return
	var metrics={"terrain3dVersion":String(terrain.version),"regionSize":int(terrain.region_size),"regionCount":regions,"alignedSamples":aligned,"seamSamples":seam_samples,
		"forbiddenRoadPathOverlaySamples":forbidden_overlay_samples,"maxHeightError":snappedf(max_height,0.00000001),"maxActualBlend":snappedf(max_blend,0.00000001),
		"maxColorError":snappedf(max_color,0.00000001),"maxRoughnessError":snappedf(max_rough,0.00000001),"maxSeamHeightError":snappedf(max_seam_height,0.00000001),
		"maxSeamBlend":snappedf(max_seam_blend,0.00000001),"maxSeamMaterialError":snappedf(max_seam_material,0.00000001),"bakedSurfaces":mesh.get_surface_count(),
		"bakedVertices":vertices.size(),"savedRegionFiles":saved["files"].size(),"savedRegionBytes":int(saved["bytes"])}
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.terrain3d-proof")); var file:=FileAccess.open(METRICS_PATH,FileAccess.WRITE)
	if not _require(file!=null,"could not write metrics"):return
	file.store_string(JSON.stringify(metrics)+"\n"); file.close(); print("G60_TERRAIN3D_ROAD_PATH_METRICS="+JSON.stringify(metrics)); print("NE_G60_TERRAIN3D_ROAD_PATH_VALIDATION_OK"); quit(0)
