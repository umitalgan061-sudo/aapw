extends SceneTree
const PROBE := "res://.terrain3d-proof/g77-relief-probe.json"
const N := 257
func _initialize() -> void: call_deferred("_run")
func _fail(message:String)->void: push_error("G77 Terrain3D seam audit failed: "+message); quit(1)
func _need(ok:bool,message:String)->bool:
	if not ok: _fail(message); return false
	return true
func _height(probe:Dictionary,u:float,v:float)->float:
	var rows:Array=probe["rows"]; var gx:=clampf(u,0,1)*64.0; var gy:=clampf(v,0,1)*64.0; var x0:=int(floor(gx)); var y0:=int(floor(gy)); var x1:=mini(x0+1,64); var y1:=mini(y0+1,64); var tx:=gx-x0; var ty:=gy-y0
	return lerpf(lerpf(float(rows[y0][x0]),float(rows[y0][x1]),tx),lerpf(float(rows[y1][x0]),float(rows[y1][x1]),tx),ty)
func _image(probe:Dictionary)->Image:
	var image:=Image.create_empty(N,N,false,Image.FORMAT_RF)
	for z in N:
		for x in N: image.set_pixel(x,z,Color(_height(probe,float(x)/256.0,float(z)/256.0),0,0,1))
	return image
func _run()->void:
	if not _need(FileAccess.file_exists(PROBE),"probe missing"): return
	var parsed=JSON.parse_string(FileAccess.get_file_as_string(PROBE)); if not _need(parsed is Dictionary,"probe invalid"): return
	var probe:Dictionary=parsed; var terrain:=Terrain3D.new(); get_root().add_child(terrain); terrain.region_size=256; terrain.data.import_images([_image(probe),null,null],Vector3.ZERO,0.0,1.0)
	if not _need(String(terrain.version).begins_with("1.0.2") and terrain.data.get_region_count()>=4,"Terrain3D import failed"): return
	var edges=[254.0,254.5,255.0,255.5]; var cross=[16.25,32.25,64.5,96.5,128.25,160.75,192.5,224.5,254.5,255.0,255.5]
	var max_h:=0.0; var max_d:=0.0; var max_n:=0.0; var samples:=0
	for edge in edges:
		for other in cross:
			for q in [Vector2(edge,other),Vector2(other,edge)]:
				var actual:=terrain.data.get_height(Vector3(q.x,0,q.y)); var expected:=_height(probe,q.x/256.0,q.y/256.0); max_h=maxf(max_h,absf(actual-expected))
				var dx:=terrain.data.get_height(Vector3(q.x+0.5,0,q.y))-terrain.data.get_height(Vector3(q.x-0.5,0,q.y)); var dz:=terrain.data.get_height(Vector3(q.x,0,q.y+0.5))-terrain.data.get_height(Vector3(q.x,0,q.y-0.5))
				var ex:=_height(probe,(q.x+0.5)/256.0,q.y/256.0)-_height(probe,(q.x-0.5)/256.0,q.y/256.0); var ez:=_height(probe,q.x/256.0,(q.y+0.5)/256.0)-_height(probe,q.x/256.0,(q.y-0.5)/256.0)
				max_d=maxf(max_d,maxf(absf(dx-ex),absf(dz-ez))); max_n=maxf(max_n,Vector3(-dx,1,-dz).normalized().distance_to(Vector3(-ex,1,-ez).normalized())); samples+=1
	if not _need(samples>=80 and max_h<=0.02 and max_d<=0.03 and max_n<=0.003,"255/256 focused seam contract failed"): return
	print("G77_TERRAIN3D_RELIEF_SEAM_METRICS="+JSON.stringify({"samples":samples,"maxHeightError":snappedf(max_h,0.00000001),"maxDerivativeError":snappedf(max_d,0.00000001),"maxNormalError":snappedf(max_n,0.00000001)})); print("SE_G77_TERRAIN3D_RELIEF_SEAM_OK"); quit(0)
