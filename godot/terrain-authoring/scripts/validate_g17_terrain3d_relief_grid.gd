extends SceneTree
const PROBE := "res://.terrain3d-proof/g17-relief-probe.json"
const N := 257

func _initialize() -> void: call_deferred("_run")
func fail(message:String) -> void: push_error("G17 Terrain3D grid audit failed: "+message); quit(1)
func need(ok:bool,message:String)->bool:
	if not ok: fail(message); return false
	return true
func source_h(p:Dictionary,u:float,v:float)->float:
	var rows:Array=p.rows; var gx:=clampf(u,0,1)*64.0; var gy:=clampf(v,0,1)*64.0
	var x0:=int(floor(gx)); var y0:=int(floor(gy)); var x1:=mini(x0+1,64); var y1:=mini(y0+1,64)
	return lerpf(lerpf(float(rows[y0][x0]),float(rows[y0][x1]),gx-x0),lerpf(float(rows[y1][x0]),float(rows[y1][x1]),gx-x0),gy-y0)
func image_from(p:Dictionary)->Image:
	var image:=Image.create_empty(N,N,false,Image.FORMAT_RF)
	for z in N:
		for x in N: image.set_pixel(x,z,Color(source_h(p,float(x)/256.0,float(z)/256.0),0,0,1))
	return image
func _run()->void:
	if not need(FileAccess.file_exists(PROBE),"probe missing"): return
	var p=JSON.parse_string(FileAccess.get_file_as_string(PROBE)); if not need(p is Dictionary,"probe invalid"): return
	var t:=Terrain3D.new(); get_root().add_child(t); t.region_size=256
	if not need(String(t.version).begins_with("1.0.2"),"pinned Terrain3D did not load"): return
	t.data.import_images([image_from(p),null,null],Vector3.ZERO,0.0,1.0)
	var max_error:=0.0; var min_h:=INF; var max_h:=-INF; var sum:=0.0; var count:=0; var checksum:int=2166136261
	for z in N:
		for x in N:
			var actual:=t.data.get_height(Vector3(x,0,z)); var expected:=source_h(p,float(x)/256.0,float(z)/256.0)
			if is_nan(actual) or is_inf(actual): fail("non-finite height"); return
			if actual>=float(p.waterCeilingMeters): fail("marine ceiling violation"); return
			max_error=maxf(max_error,absf(actual-expected)); min_h=minf(min_h,actual); max_h=maxf(max_h,actual); sum+=actual; count+=1
			checksum=int((checksum^int(round((actual+32.0)*1000.0)))*16777619)&0xffffffff
	if not need(count==N*N,"sample count changed"): return
	if not need(max_error<=0.012,"full-grid height error exceeded tolerance"): return
	if not need(max_h>min_h,"full-grid relief collapsed"): return
	var metrics={"samples":count,"maxHeightError":snappedf(max_error,0.00000001),"minHeight":snappedf(min_h,0.000001),"maxHeight":snappedf(max_h,0.000001),"meanHeight":snappedf(sum/float(count),0.000001),"checksum":checksum,"regionCount":t.data.get_region_count()}
	print("G17_TERRAIN3D_RELIEF_GRID_METRICS="+JSON.stringify(metrics)); print("SW_G17_TERRAIN3D_RELIEF_GRID_OK"); quit(0)
