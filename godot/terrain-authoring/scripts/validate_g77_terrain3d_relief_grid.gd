extends SceneTree

const PROBE := "res://.terrain3d-proof/g77-relief-probe.json"
const N := 257

func _initialize() -> void: call_deferred("_run")
func _fail(message:String)->void: push_error("G77 Terrain3D grid audit failed: "+message); quit(1)
func _need(ok:bool,message:String)->bool:
	if not ok: _fail(message); return false
	return true
func _source_height(probe:Dictionary,u:float,v:float)->float:
	var rows:Array=probe["rows"]; var gx:=clampf(u,0,1)*64.0; var gy:=clampf(v,0,1)*64.0
	var x0:=int(floor(gx)); var y0:=int(floor(gy)); var x1:=mini(x0+1,64); var y1:=mini(y0+1,64); var tx:=gx-x0; var ty:=gy-y0
	return lerpf(lerpf(float(rows[y0][x0]),float(rows[y0][x1]),tx),lerpf(float(rows[y1][x0]),float(rows[y1][x1]),tx),ty)
func _image_from(probe:Dictionary)->Image:
	var image:=Image.create_empty(N,N,false,Image.FORMAT_RF)
	for z in N:
		for x in N: image.set_pixel(x,z,Color(_source_height(probe,float(x)/256.0,float(z)/256.0),0,0,1))
	return image
func _run()->void:
	if not _need(FileAccess.file_exists(PROBE),"probe missing"): return
	var parsed=JSON.parse_string(FileAccess.get_file_as_string(PROBE)); if not _need(parsed is Dictionary,"probe invalid"): return
	var probe:Dictionary=parsed; var terrain:=Terrain3D.new(); get_root().add_child(terrain); terrain.region_size=256
	if not _need(String(terrain.version).begins_with("1.0.2"),"pinned Terrain3D did not load"): return
	terrain.data.import_images([_image_from(probe),null,null],Vector3.ZERO,0.0,1.0)
	if not _need(terrain.data.get_region_count()>=4,"full-grid import lost regions"): return
	var max_error:=0.0; var min_h:=INF; var max_h:=-INF; var sum:=0.0; var count:=0; var checksum:int=2166136261
	for z in N:
		for x in N:
			var actual:=terrain.data.get_height(Vector3(x,0,z)); var expected:=_source_height(probe,float(x)/256.0,float(z)/256.0)
			if is_nan(actual) or is_inf(actual): _fail("non-finite full-grid height"); return
			max_error=maxf(max_error,absf(actual-expected)); min_h=minf(min_h,actual); max_h=maxf(max_h,actual); sum+=actual; count+=1
			checksum=int((checksum^int(round((actual+128.0)*1000.0)))*16777619)&0xffffffff
	if not _need(count==N*N and max_error<=0.012 and min_h<0.0 and max_h>0.0,"full-grid height contract failed"): return
	var fractional_max:=0.0; var normal_length_error:=0.0; var fractional_checksum:int=2166136261; var fractional_samples:=0
	for i in 8192:
		var x:=1.0+fmod(float(i*73)+0.375,254.0); var z:=1.0+fmod(float(i*151)+0.625,254.0); var actual:=terrain.data.get_height(Vector3(x,0,z)); var expected:=_source_height(probe,x/256.0,z/256.0); var normal:=terrain.data.get_normal(Vector3(x,0,z))
		if is_nan(actual) or is_inf(actual) or is_nan(normal.x) or is_nan(normal.y) or is_nan(normal.z): _fail("non-finite fractional sample"); return
		fractional_max=maxf(fractional_max,absf(actual-expected)); normal_length_error=maxf(normal_length_error,absf(normal.length()-1.0)); fractional_checksum=int((fractional_checksum^int(round((actual+128.0)*1000.0)))*16777619)&0xffffffff; fractional_samples+=1
	if not _need(fractional_samples==8192 and fractional_max<=0.02 and normal_length_error<=0.001,"fractional interpolation contract failed"): return
	var metrics={"samples":count,"regionCount":terrain.data.get_region_count(),"maxHeightError":snappedf(max_error,0.00000001),"minHeight":snappedf(min_h,0.000001),"maxHeight":snappedf(max_h,0.000001),"meanHeight":snappedf(sum/float(count),0.000001),"checksum":checksum,"fractionalSamples":fractional_samples,"maxFractionalHeightError":snappedf(fractional_max,0.00000001),"maxNormalLengthError":snappedf(normal_length_error,0.00000001),"fractionalChecksum":fractional_checksum}
	print("G77_TERRAIN3D_RELIEF_GRID_METRICS="+JSON.stringify(metrics)); print("SE_G77_TERRAIN3D_RELIEF_GRID_OK"); quit(0)
