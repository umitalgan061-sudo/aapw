extends SceneTree
const PROBE := "res://.terrain3d-proof/g17-relief-probe.json"
const IMPORT_N := 257
const REGION_N := 256

func _initialize() -> void: call_deferred("_run")
func fail(message:String) -> void: push_error("G17 Terrain3D seam audit failed: "+message); quit(1)
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

func _run()->void:
	if not need(FileAccess.file_exists(PROBE),"probe missing"): return
	var p=JSON.parse_string(FileAccess.get_file_as_string(PROBE)); if not need(p is Dictionary,"probe invalid"): return
	var t:=Terrain3D.new(); get_root().add_child(t); t.region_size=REGION_N
	if not need(String(t.version).begins_with("1.0.2"),"pinned Terrain3D did not load"): return
	t.data.import_images([height_image(p),null,null],Vector3.ZERO,0.0,1.0)
	if not need(t.data.get_region_count()>=4,"257 import did not span four regions"): return
	var positions=[254.0,254.5,255.0,255.5,256.0]; var cross=[32.25,96.5,160.75,224.5,254.5,255.0,255.5,256.0]
	var max_height_error:=0.0; var max_slope_jump:=0.0; var samples:=0
	for edge in positions:
		for other in cross:
			for point in [Vector2(float(edge),float(other)),Vector2(float(other),float(edge))]:
				var actual:=t.data.get_height(Vector3(point.x,0,point.y)); var expected:=source_h(p,point.x/256.0,point.y/256.0)
				if is_nan(actual): fail("NaN seam sample"); return
				max_height_error=maxf(max_height_error,absf(actual-expected))
				var left:=t.data.get_height(Vector3(point.x-0.5,0,point.y)); var right:=t.data.get_height(Vector3(point.x+0.5,0,point.y))
				var down:=t.data.get_height(Vector3(point.x,0,point.y-0.5)); var up:=t.data.get_height(Vector3(point.x,0,point.y+0.5))
				max_slope_jump=maxf(max_slope_jump,absf(right-left),absf(up-down)); samples+=1
	if not need(max_height_error<=0.02,"255/256 seam height mismatch"): return
	if not need(max_slope_jump<=0.12,"255/256 seam slope jump too large"): return
	print("G17_TERRAIN3D_RELIEF_SEAM_METRICS="+JSON.stringify({"samples":samples,"maxHeightError":snappedf(max_height_error,0.00000001),"maxSlopeJump":snappedf(max_slope_jump,0.00000001)})); print("SW_G17_TERRAIN3D_RELIEF_SEAM_OK"); quit(0)
