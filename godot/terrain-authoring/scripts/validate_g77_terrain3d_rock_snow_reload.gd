extends SceneTree

const PROBE := "res://.terrain3d-proof/g77-rock-snow-probe.json"
const MAX_BLEND_ERROR := 0.006
const MAX_HEIGHT_ERROR := 0.00002
func _initialize() -> void: call_deferred("_run")
func _fail(message:String)->void: push_error("G77 Rock/Snow reload proof failed: "+message); quit(1)
func _need(ok:bool,message:String)->bool:
	if not ok: _fail(message); return false
	return true
func _source_value(probe:Dictionary,u:float,v:float,channel:int)->float:
	var rows:Array=probe["rows"]; var n:=int(probe["sourceGridSize"]); var gx:=clampf(u,0,1)*float(n-1); var gy:=clampf(v,0,1)*float(n-1)
	var x0:=int(floor(gx)); var y0:=int(floor(gy)); var x1:=mini(x0+1,n-1); var y1:=mini(y0+1,n-1); var tx:=gx-x0; var ty:=gy-y0
	var a:Array=rows[y0][x0]; var b:Array=rows[y0][x1]; var c:Array=rows[y1][x0]; var d:Array=rows[y1][x1]
	return lerpf(lerpf(float(a[channel]),float(b[channel]),tx),lerpf(float(c[channel]),float(d[channel]),tx),ty)
func _expected_control(probe:Dictionary,u:float,v:float)->Dictionary:
	var rock:=clampf(_source_value(probe,u,v,1),0,1); var snow:=clampf(_source_value(probe,u,v,2),0,1)
	return {"overlay":int(probe["snowTextureId"]) if snow>rock else int(probe["rockTextureId"]),"blend":maxf(rock,snow)}
func _run()->void:
	if not _need(FileAccess.file_exists(PROBE),"probe missing"): return
	var parsed=JSON.parse_string(FileAccess.get_file_as_string(PROBE)); if not _need(parsed is Dictionary,"probe invalid"): return
	var probe:Dictionary=parsed; var suffix:=OS.get_environment("G77_ROCK_SNOW_PROOF_SUFFIX"); if suffix.is_empty(): suffix="default"
	var directory:="user://g77-rock-snow-r9-"+suffix
	if not _need(DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(directory)),"persisted directory missing"): return
	if not _need(ClassDB.class_exists("Terrain3D"),"Terrain3D class not registered in reload process"): return
	var terrain:Variant=ClassDB.instantiate("Terrain3D"); if not _need(terrain!=null,"Terrain3D reload instantiate failed"): return
	terrain.region_size=256; get_root().add_child(terrain); terrain.data.load_directory(directory)
	if not _need(String(terrain.version).begins_with("1.0.2") and terrain.data.get_region_count()>=4,"pinned multi-region reload failed"): return
	var max_h:=0.0; var max_b:=0.0; var seam_h:=0.0; var seam_b:=0.0; var aligned:=0; var checksum:int=2166136261
	for sy in 65:
		for sx in 65:
			var u:=float(sx)/64.0; var v:=float(sy)/64.0; var pos:=Vector3(float(sx*4),0,float(sy*4)); var expected:=_expected_control(probe,u,v)
			var h:float=float(terrain.data.get_height(pos)); var blend:float=float(terrain.data.get_control_blend(pos))
			if not _need(not is_nan(h) and not is_nan(blend),"non-finite aligned reload sample"): return
			var overlay_materialized:bool=int(round(float(expected["blend"])*255.0))>0; if not _need(terrain.data.get_control_base_id(pos)==int(probe["groundTextureId"]) and (not overlay_materialized or terrain.data.get_control_overlay_id(pos)==int(expected["overlay"])),"reloaded control IDs changed"): return
			max_h=maxf(max_h,absf(h-_source_value(probe,u,v,4))); max_b=maxf(max_b,absf(blend-float(expected["blend"]))); checksum=int((checksum^int(round(clampf(blend,0,1)*255.0)))*16777619)&0xffffffff; aligned+=1
	var seam_samples:=0
	for edge in [255.0,256.0]:
		for other in range(0,257,16):
			for point in [Vector2(edge,float(other)),Vector2(float(other),edge)]:
				var u:float=float(point.x)/256.0; var v:float=float(point.y)/256.0; var pos:Vector3=Vector3(float(point.x),0.0,float(point.y)); var expected:Dictionary=_expected_control(probe,u,v)
				var seam_overlay_materialized:bool=int(round(float(expected["blend"])*255.0))>0
				if not _need(terrain.data.get_control_base_id(pos)==int(probe["groundTextureId"]) and (not seam_overlay_materialized or terrain.data.get_control_overlay_id(pos)==int(expected["overlay"])),"255/256 reloaded control IDs changed"): return
				var seam_height:float=float(terrain.data.get_height(pos)); var seam_blend:float=float(terrain.data.get_control_blend(pos)); seam_h=maxf(seam_h,absf(seam_height-_source_value(probe,u,v,4))); seam_b=maxf(seam_b,absf(seam_blend-float(expected["blend"]))); seam_samples+=1
	if not _need(aligned==4225 and max_h<=MAX_HEIGHT_ERROR and max_b<=MAX_BLEND_ERROR,"aligned save/reload parity failed"): return
	if not _need(seam_samples==68 and seam_h<=MAX_HEIGHT_ERROR and seam_b<=MAX_BLEND_ERROR,"255/256 save/reload seam parity failed"): return
	var mesh:Mesh=terrain.bake_mesh(0); if not _need(mesh!=null and mesh.get_surface_count()>0,"reloaded LOD0 bake empty"): return
	var vertices:PackedVector3Array=mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]; if not _need(vertices.size()>0,"reloaded LOD0 vertices empty"): return
	print("G77_TERRAIN3D_ROCK_SNOW_RELOAD_METRICS="+JSON.stringify({"regionCount":terrain.data.get_region_count(),"alignedSamples":aligned,"seamSamples":seam_samples,"maxHeightError":max_h,"maxBlendError":max_b,"seamHeightError":seam_h,"seamBlendError":seam_b,"checksum":checksum,"bakedSurfaces":mesh.get_surface_count(),"bakedVertices":vertices.size()}))
	print("SE_G77_TERRAIN3D_ROCK_SNOW_RELOAD_OK"); quit(0)
