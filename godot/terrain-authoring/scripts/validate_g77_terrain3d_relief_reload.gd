extends SceneTree

const PROBE := "res://.terrain3d-proof/g77-relief-probe.json"
const SOURCE_SIZE := 65
const REGION_SIZE := 256

func _initialize() -> void: call_deferred("_run")
func _fail(message:String)->void: push_error("G77 Terrain3D reload proof failed: "+message); quit(1)
func _need(ok:bool,message:String)->bool:
	if not ok: _fail(message); return false
	return true

func _source_height(probe:Dictionary,u:float,v:float)->float:
	var rows:Array=probe["rows"]; var gx:=clampf(u,0,1)*64.0; var gy:=clampf(v,0,1)*64.0
	var x0:=int(floor(gx)); var y0:=int(floor(gy)); var x1:=mini(x0+1,64); var y1:=mini(y0+1,64); var tx:=gx-x0; var ty:=gy-y0
	return lerpf(lerpf(float(rows[y0][x0]),float(rows[y0][x1]),tx),lerpf(float(rows[y1][x0]),float(rows[y1][x1]),tx),ty)

func _run()->void:
	if not _need(FileAccess.file_exists(PROBE),"probe missing"): return
	var parsed=JSON.parse_string(FileAccess.get_file_as_string(PROBE)); if not _need(parsed is Dictionary,"probe invalid"): return
	var probe:Dictionary=parsed; if not _need(int(probe.get("canonicalWater",0))==44 and int(probe.get("canonicalLand",0))==52,"G77 hydrology fingerprint changed"): return
	var suffix:=OS.get_environment("G77_RELIEF_PROOF_SUFFIX"); if suffix.is_empty(): suffix="default"
	var directory:="user://g77-relief-"+suffix
	if not _need(DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(directory)),"persisted directory missing"): return
	var terrain:=Terrain3D.new(); get_root().add_child(terrain); terrain.region_size=REGION_SIZE
	if not _need(String(terrain.version).begins_with("1.0.2"),"pinned Terrain3D did not load"): return
	terrain.data.load_directory(directory)
	if not _need(terrain.data.get_region_count()>=4,"persisted reload region count regressed"): return
	var max_error:=0.0; var min_h:=INF; var max_h:=-INF; var checksum:int=2166136261; var aligned:=0
	for sy in SOURCE_SIZE:
		for sx in SOURCE_SIZE:
			var actual:=terrain.data.get_height(Vector3(sx*4,0,sy*4)); var expected:=_source_height(probe,float(sx)/64.0,float(sy)/64.0)
			if is_nan(actual) or is_inf(actual): _fail("non-finite reloaded height"); return
			max_error=maxf(max_error,absf(actual-expected)); min_h=minf(min_h,actual); max_h=maxf(max_h,actual); aligned+=1
			checksum=int((checksum^int(round((actual+128.0)*1000.0)))*16777619)&0xffffffff
	if not _need(aligned==4225 and max_error<=0.012,"reloaded aligned roundtrip failed"): return
	if not _need(min_h<0.0 and max_h>0.0,"reloaded mixed relief range invalid"): return
	var positions=[254.5,255.0,255.5,256.0]; var cross=[32.25,96.5,160.75,224.5,254.5,255.0,255.5,256.0]
	var max_seam:=0.0; var seam_samples:=0
	for edge in positions:
		for other in cross:
			for point in [Vector2(float(edge),float(other)),Vector2(float(other),float(edge))]:
				var actual:=terrain.data.get_height(Vector3(point.x,0,point.y)); var expected:=_source_height(probe,point.x/256.0,point.y/256.0)
				if is_nan(actual) or is_inf(actual): _fail("non-finite reloaded seam height"); return
				max_seam=maxf(max_seam,absf(actual-expected)); seam_samples+=1
	if not _need(max_seam<=0.02,"reloaded 255/256 seam failed"): return
	var mesh:Mesh=terrain.bake_mesh(0); if not _need(mesh!=null and mesh.get_surface_count()>0,"reloaded LOD0 bake empty"): return
	var vertices:PackedVector3Array=mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]; if not _need(vertices.size()>0,"reloaded LOD0 vertices empty"): return
	var metrics={"terrain3dVersion":String(terrain.version),"regionCount":terrain.data.get_region_count(),"alignedSamples":aligned,"seamSamples":seam_samples,"maxAlignedHeightError":snappedf(max_error,0.00000001),"maxSeamHeightError":snappedf(max_seam,0.00000001),"minReloadedHeight":snappedf(min_h,0.000001),"maxReloadedHeight":snappedf(max_h,0.000001),"reloadChecksum":checksum,"bakedSurfaces":mesh.get_surface_count(),"bakedVertices":vertices.size()}
	print("G77_TERRAIN3D_RELIEF_RELOAD_METRICS="+JSON.stringify(metrics)); print("SE_G77_TERRAIN3D_RELIEF_RELOAD_OK"); quit(0)
