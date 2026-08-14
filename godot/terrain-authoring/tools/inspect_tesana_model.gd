extends SceneTree

func _initialize() -> void:
	var model_path := "res://assets/tesana_westeros/characters/player_heir/player_heir.glb"
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--model="):
			model_path = argument.trim_prefix("--model=")
	var packed := load(model_path) as PackedScene
	if packed == null:
		push_error("Unable to load model: %s" % model_path)
		quit(1)
		return
	var instance := packed.instantiate()
	root.add_child(instance)
	print("MODEL_TREE ", model_path)
	_print_node(instance, 0)
	quit()

func _print_node(node: Node, depth: int) -> void:
	print("  ".repeat(depth), node.name, " [", node.get_class(), "] unique=", node.unique_name_in_owner)
	for child in node.get_children():
		_print_node(child, depth + 1)
