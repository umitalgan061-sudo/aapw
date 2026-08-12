extends SceneTree

func _initialize() -> void:
	var failures: Array[String] = []
	if not ClassDB.class_exists("Terrain3D"):
		failures.append("Terrain3D GDExtension class is not registered")
	if not FileAccess.file_exists("res://addons/terrain_3d/plugin.cfg"):
		failures.append("Terrain3D plugin.cfg is missing")
	if not FileAccess.file_exists("res://addons/terrain_3d/terrain.gdextension"):
		failures.append("Terrain3D terrain.gdextension is missing")
	var project_file := FileAccess.open("res://project.godot", FileAccess.READ)
	if project_file == null:
		failures.append("project.godot cannot be read")
	else:
		var project_text := project_file.get_as_text()
		if project_text.find("res://addons/zylann.hterrain/plugin.cfg") < 0:
			failures.append("HTerrain is no longer enabled")
		if project_text.find("res://addons/terrain_3d/plugin.cfg") < 0:
			failures.append("Terrain3D is not enabled")
	if not failures.is_empty():
		for failure in failures:
			push_error(failure)
		quit(1)
		return
	print("TERRAIN3D_TOOLCHAIN_VALIDATION_OK")
	quit(0)
