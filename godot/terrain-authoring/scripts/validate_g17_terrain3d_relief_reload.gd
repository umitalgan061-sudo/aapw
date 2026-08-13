extends SceneTree
const PROBE := "res://.terrain3d-proof/g17-relief-probe.json"
const SOURCE_N := 65
const WATER_CEILING := -2.5

func _initialize() -> void: call_deferred("_run")
func fail(message:String) -> void: push_error("G17 Terrain3D reload proof failed: "+message); quit(1)
func need(ok:bool,message:String)->bool:
	if not ok: fail(message); return false
	return true

func source_h(p:Dictionary,u:float,v:float)->float:
	var rows:Array=p.rows; var gx:=clampf(u,0,1)*64.0; var gy:=clampf(v,0,1)*64.0
	var x0:=int(floor(gx)); var y0:=int(floor(gy)); var x1:=mini(x0+1,64); var y1:=mini(y0+1,64)
	return lerpf(lerpf(float(rows[y0][x0]),float(rows[y0][x1]),gx-x0),lerpf(float(rows[y1][x0]),float(rows[y1][x1]),gx-x0),gy-y0)

func _run()->void:
	if not need(FileAccess.file_exists(PROBE),"probe missing"): return
	var p=JSON.parse_string(FileAccess.get_file_as_string(PROBE)); if not need(p is Dictionary,"probe invalid"): return
	var suffix:=OS.get_environment("G17_RELIEF_PROOF_SUFFIX"); if suffix.is_empty(): suffix="default"
	var directory:="user://g17-relief-"+suffix
	if not need(DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(directory)),"persisted directory missing"): return
	var t:=Terrain3D.new(); get_root().add_child(t); t.region_size=256
	if not need(String(t.version).begins_with("1.0.2"),"pinned Terrain3D did not load"): return
	t.data.load_directory(directory)
	if not need(t.data.get_region_count()>=4,"persisted reload region count regressed"): return
	var max_aligned:=0.0; var min_h:=INF; var max_h:=-INF; var checksum:int=2166136261; var aligned:=0
	for sy in SOURCE_N:
		for sx in SOURCE_N:
			var actual:=t.data.get_height(Vector3(sx*4,0,sy*4)); var expected:=source_h(p,float(sx)/64.0,float(sy)/64.0)
			if is_nan(actual) or is_inf(actual): fail("non-finite reloaded height"); return
			max_aligned=maxf(max_aligned,absf(actual-expected)); min_h=minf(min_h,actual); max_h=maxf(max_h,actual); aligned+=1
			checksum=int((checksum^int(round((actual+32.0)*1000.0)))*16777619)&0xffffffff
	if not need(aligned==4225 and max_aligned<=0.012,"reloaded aligned roundtrip failed"): return
	if not need(max_h<WATER_CEILING and max_h>min_h,"reloaded marine relief range invalid"): return
	var positions=[254.5,255.0,255.5,256.0]; var cross=[32.25,96.5,160.75,224.5,254.5,255.0,255.5,256.0]
	var max_seam:=0.0; var seam_samples:=0
	for edge in positions:
		for other in cross:
			for point in [Vector2(float(edge),float(other)),Vector2(float(other),float(edge))]:
				var actual:=t.data.get_height(Vector3(point.x,0,point.y)); var expected:=source_h(p,point.x/256.0,point.y/256.0)
				if is_nan(actual) or is_inf(actual): fail("non-finite reloaded seam height"); return
				max_seam=maxf(max_seam,absf(actual-expected)); seam_samples+=1
	if not need(max_seam<=0.02,"reloaded 255/256 seam failed"): return
	var mesh:Mesh=t.bake_mesh(0); if not need(mesh!=null and mesh.get_surface_count()>0,"reloaded LOD0 bake empty"): return
	var vertices:PackedVector3Array=mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]; if not need(vertices.size()>0,"reloaded LOD0 vertices empty"): return
	var m={"terrain3dVersion":String(t.version),"regionCount":t.data.get_region_count(),"alignedSamples":aligned,"seamSamples":seam_samples,"maxAlignedHeightError":snappedf(max_aligned,0.00000001),"maxSeamHeightError":snappedf(max_seam,0.00000001),"minReloadedHeight":snappedf(min_h,0.000001),"maxReloadedHeight":snappedf(max_h,0.000001),"reloadChecksum":checksum,"bakedSurfaces":mesh.get_surface_count(),"bakedVertices":vertices.size()}
	print("G17_TERRAIN3D_RELIEF_RELOAD_METRICS="+JSON.stringify(m)); print("SW_G17_TERRAIN3D_RELIEF_RELOAD_OK"); quit(0)
