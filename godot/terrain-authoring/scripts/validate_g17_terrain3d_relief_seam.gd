extends SceneTree
const PROBE := "res://.terrain3d-proof/g17-relief-probe.json"
const N := 257
func _initialize() -> void: call_deferred("_run")
func fail(m:String)->void: push_error("G17 Terrain3D seam audit failed: "+m); quit(1)
func need(ok:bool,m:String)->bool:
	if not ok: fail(m); return false
	return true
func h(p:Dictionary,u:float,v:float)->float:
	var r:Array=p.rows; var gx:=clampf(u,0,1)*64.0; var gy:=clampf(v,0,1)*64.0; var x0:=int(floor(gx)); var y0:=int(floor(gy)); var x1:=mini(x0+1,64); var y1:=mini(y0+1,64)
	return lerpf(lerpf(float(r[y0][x0]),float(r[y0][x1]),gx-x0),lerpf(float(r[y1][x0]),float(r[y1][x1]),gx-x0),gy-y0)
func image(p:Dictionary)->Image:
	var im:=Image.create_empty(N,N,false,Image.FORMAT_RF)
	for z in N:
		for x in N: im.set_pixel(x,z,Color(h(p,float(x)/256.0,float(z)/256.0),0,0,1))
	return im
func _run()->void:
	if not need(FileAccess.file_exists(PROBE),"probe missing"): return
	var p=JSON.parse_string(FileAccess.get_file_as_string(PROBE)); if not need(p is Dictionary,"probe invalid"): return
	var t:=Terrain3D.new(); get_root().add_child(t); t.region_size=256; t.data.import_images([image(p),null,null],Vector3.ZERO,0.0,1.0)
	if not need(String(t.version).begins_with("1.0.2") and t.data.get_region_count()>=4,"Terrain3D import failed"): return
	var edges=[254.0,254.5,255.0,255.5]; var cross=[16.25,32.25,64.5,96.5,128.25,160.75,192.5,224.5,254.5,255.0,255.5]
	var max_h:=0.0; var max_d:=0.0; var max_n:=0.0; var samples:=0
	for edge in edges:
		for other in cross:
			for q in [Vector2(edge,other),Vector2(other,edge)]:
				var actual:=t.data.get_height(Vector3(q.x,0,q.y)); var expected:=h(p,q.x/256.0,q.y/256.0); max_h=maxf(max_h,absf(actual-expected))
				var dx:=t.data.get_height(Vector3(q.x+0.5,0,q.y))-t.data.get_height(Vector3(q.x-0.5,0,q.y)); var dz:=t.data.get_height(Vector3(q.x,0,q.y+0.5))-t.data.get_height(Vector3(q.x,0,q.y-0.5))
				var ex:=h(p,(q.x+0.5)/256.0,q.y/256.0)-h(p,(q.x-0.5)/256.0,q.y/256.0); var ez:=h(p,q.x/256.0,(q.y+0.5)/256.0)-h(p,q.x/256.0,(q.y-0.5)/256.0)
				var de:=maxf(absf(dx-ex),absf(dz-ez)); max_d=maxf(max_d,de); max_n=maxf(max_n,Vector3(-dx,1,-dz).normalized().distance_to(Vector3(-ex,1,-ez).normalized())); samples+=1
	if not need(samples>=80,"seam sample count too small"): return
	if not need(max_h<=0.02,"255/256 seam height mismatch"): return
	if not need(max_d<=float(p.proofContract.maxSeamDerivativeError),"255/256 seam derivative mismatch"): return
	if not need(max_n<=0.003,"255/256 seam normal mismatch"): return
	print("G17_TERRAIN3D_RELIEF_SEAM_METRICS="+JSON.stringify({"samples":samples,"maxHeightError":snappedf(max_h,0.00000001),"maxSlopeJump":snappedf(max_d,0.00000001),"maxDerivativeError":snappedf(max_d,0.00000001),"maxNormalError":snappedf(max_n,0.00000001)})); print("SW_G17_TERRAIN3D_RELIEF_SEAM_OK"); quit(0)
