class_name TreeFactory
extends Object
##
## Deterministic procedural tree builder.
##
## build() turns a params dictionary + seed into exactly TWO ArrayMeshes:
##   - wood: every branch as a low-poly tapered tube (one surface)
##   - leaves: alpha-cutout cards sampling random cells of a leaf atlas
##
## Two meshes per species = drop-in compatible with the FluffyTrees-style
## MultiMesh scatter (a whole forest stays 2 draw calls).
##
## Leaf card vertex data contract (consumed by leaf_atlas.gdshader):
##   UV     = atlas cell rect (texture sampling)
##   UV2    = card-corner offset in world units (billboard puff math)
##   COLOR  = r: wind phase, g: canopy height 0..1, b: unused, a: 1

const DEFAULTS := {
	"seed": 1337,
	"trunk_height": 6.0,
	"trunk_radius": 0.35,
	"taper": 0.45,              # tip radius as fraction of base radius
	"levels": 3,                # branch recursion depth
	"branches_per_level": 4,
	"branch_angle_deg": 42.0,
	"length_ratio": 0.62,       # child length vs parent
	"radius_ratio": 0.58,       # child base radius vs parent at attach point
	"gnarl": 0.25,              # random bend per segment
	"upward_bias": 0.30,        # branches drift up (+) or droop (-)
	"segments_per_branch": 5,
	"radial_segments": 6,
	"branch_start": 0.35,       # children spawn from this fraction up the parent
	"branch_mode": 0,           # 0 = scattered (deciduous), 1 = whorled rings (conifer)
	"length_falloff": 0.0,      # children near the tip get shorter -> conical silhouette
	"droop": 0.0,               # progressive downward bend along each branch (willow/spruce)
	"cluster_along": 0.0,       # chance of extra leaf clusters along the branch, not just tips
	"cluster_flatten": 0.0,     # squash leaf clusters vertically (parasol/acacia canopies)
	"leaf_card_size": 1.5,
	"leaf_size_jitter": 0.35,
	"leaves_per_cluster": 7,
	"cluster_radius": 0.9,
}

const MAX_BRANCHES := 1400


static func build(params: Dictionary, atlas_cells: int) -> Dictionary:
	var p: Dictionary = DEFAULTS.duplicate()
	for k in params.keys():
		p[k] = params[k]

	var rng := RandomNumberGenerator.new()
	rng.seed = int(p["seed"])

	var branches: Array = []
	var clusters: Array = []   # of Dictionary {"center": Vector3}
	var state := {"budget": MAX_BRANCHES}
	_grow(branches, clusters, p, rng, state,
		Vector3.ZERO, Vector3.UP,
		float(p["trunk_height"]), float(p["trunk_radius"]), 0)

	var wood: ArrayMesh = _build_wood_mesh(branches, p)
	var leaves: ArrayMesh = _build_leaf_mesh(clusters, p, atlas_cells, rng)

	var centers := PackedVector3Array()
	for c in clusters:
		centers.append(c["center"])

	return {
		"wood": wood,
		"leaves": leaves,
		"branch_count": branches.size(),
		"cluster_count": clusters.size(),
		"cluster_centers": centers,
	}


# ---------------------------------------------------------------- skeleton

static func _grow(
		branches: Array, clusters: Array, p: Dictionary,
		rng: RandomNumberGenerator, state: Dictionary,
		origin: Vector3, dir: Vector3,
		length: float, radius: float, level: int
	) -> void:
	if state["budget"] <= 0:
		return
	state["budget"] = int(state["budget"]) - 1

	var seg_count: int = maxi(2, int(p["segments_per_branch"]))
	var step: float = length / float(seg_count)
	var gnarl: float = float(p["gnarl"])
	var up_bias: float = float(p["upward_bias"])
	var droop: float = float(p["droop"])

	var pts := PackedVector3Array()
	var radii := PackedFloat32Array()
	var pos := origin
	var d := dir.normalized()
	var tip_r: float = radius * float(p["taper"])
	pts.append(pos)
	radii.append(radius)
	for i in range(seg_count):
		var t: float = float(i + 1) / float(seg_count)
		var bend := Vector3(
			rng.randf_range(-1.0, 1.0),
			rng.randf_range(-1.0, 1.0),
			rng.randf_range(-1.0, 1.0)
		).normalized()
		# Droop is progressive (t-weighted): bases stay stiff, tips sag.
		# The trunk (level 0) is exempt so willows keep a solid bole.
		var droop_amt: float = 0.0 if level == 0 else droop * 0.30 * t
		d = (d + bend * gnarl * 0.35 + Vector3.UP * up_bias * 0.16
			+ Vector3.DOWN * droop_amt).normalized()
		pos += d * step
		pts.append(pos)
		radii.append(lerpf(radius, tip_r, t))

	branches.append({"points": pts, "radii": radii, "level": level})

	var levels: int = int(p["levels"])
	if level < levels:
		var n: int = maxi(1, int(p["branches_per_level"]))
		var b_start: float = clampf(float(p["branch_start"]), 0.05, 0.9)
		var whorled: bool = int(p["branch_mode"]) == 1

		if whorled and level == 0:
			# Conifer habit: n evenly spaced rings of branches around the
			# trunk, each ring fanning out in all directions.
			var per_whorl: int = 5
			for w in range(n):
				var t: float = lerpf(b_start, 0.95,
					float(w) / maxf(float(n - 1), 1.0))
				var base_az: float = rng.randf() * TAU
				for j in range(per_whorl):
					var az: float = base_az + TAU * float(j) / float(per_whorl) \
						+ rng.randf_range(-0.25, 0.25)
					_spawn_child(branches, clusters, p, rng, state,
						pts, radius, tip_r, length, level, t, az)
		else:
			# Deeper levels of a whorled tree branch sparsely; deciduous
			# trees use the full count everywhere.
			var n_eff: int = mini(n, 3) if whorled else n
			for k in range(n_eff):
				var t: float = lerpf(b_start, 0.97,
					(float(k) + rng.randf() * 0.8) / float(n_eff))
				_spawn_child(branches, clusters, p, rng, state,
					pts, radius, tip_r, length, level, t, rng.randf() * TAU)

	# Leaf clusters live on the outermost two levels of the hierarchy.
	var leaf_start: int = maxi(1, levels - 1)
	if level >= leaf_start:
		clusters.append({"center": pts[pts.size() - 1]})
		if level == levels and rng.randf() < 0.55:
			clusters.append({"center": _sample_spline(pts, 0.55)})
		# Foliage sleeves along the branch (pine boughs, willow curtains).
		var along: float = clampf(float(p["cluster_along"]), 0.0, 1.0)
		if along > 0.0:
			for tt in [0.35, 0.6, 0.8]:
				if rng.randf() < along:
					clusters.append({"center": _sample_spline(pts, tt)})


static func _spawn_child(
		branches: Array, clusters: Array, p: Dictionary,
		rng: RandomNumberGenerator, state: Dictionary,
		pts: PackedVector3Array, radius: float, tip_r: float,
		length: float, level: int, t: float, azimuth: float
	) -> void:
	var attach_pos: Vector3 = _sample_spline(pts, t)
	var attach_dir: Vector3 = _sample_tangent(pts, t)
	var attach_r: float = lerpf(radius, tip_r, t)

	var perp := _any_perpendicular(attach_dir)
	var axis := perp.rotated(attach_dir, azimuth).normalized()
	var angle: float = deg_to_rad(float(p["branch_angle_deg"])
		* rng.randf_range(0.75, 1.25))
	var child_dir := attach_dir.rotated(axis, angle)

	# Higher attachments yield shorter children -> conical silhouette.
	var falloff: float = clampf(float(p["length_falloff"]), 0.0, 0.95)
	var len_scale: float = lerpf(1.0, 1.0 - falloff, t)
	var child_len: float = length * float(p["length_ratio"]) \
		* rng.randf_range(0.75, 1.15) * maxf(len_scale, 0.12)
	var child_r: float = maxf(attach_r * float(p["radius_ratio"]), 0.01)
	_grow(branches, clusters, p, rng, state,
		attach_pos, child_dir, child_len, child_r, level + 1)


static func _sample_spline(pts: PackedVector3Array, t: float) -> Vector3:
	var f: float = clampf(t, 0.0, 1.0) * float(pts.size() - 1)
	var i: int = mini(int(f), pts.size() - 2)
	return pts[i].lerp(pts[i + 1], f - float(i))


static func _sample_tangent(pts: PackedVector3Array, t: float) -> Vector3:
	var f: float = clampf(t, 0.0, 1.0) * float(pts.size() - 1)
	var i: int = mini(int(f), pts.size() - 2)
	return (pts[i + 1] - pts[i]).normalized()


static func _any_perpendicular(v: Vector3) -> Vector3:
	var ref := Vector3.RIGHT if absf(v.dot(Vector3.RIGHT)) < 0.9 else Vector3.FORWARD
	return v.cross(ref).normalized()


# ---------------------------------------------------------------- wood mesh

static func _build_wood_mesh(branches: Array, p: Dictionary) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var radial: int = clampi(int(p["radial_segments"]), 3, 12)

	for b in branches:
		var pts: PackedVector3Array = b["points"]
		var radii: PackedFloat32Array = b["radii"]
		var ring_count: int = pts.size()

		# Parallel-transport frame so tube rings don't twist.
		var rings: Array = []   # of PackedVector3Array
		var u := _any_perpendicular((pts[1] - pts[0]).normalized())
		for i in range(ring_count):
			var tangent: Vector3
			if i == 0:
				tangent = (pts[1] - pts[0]).normalized()
			elif i == ring_count - 1:
				tangent = (pts[i] - pts[i - 1]).normalized()
			else:
				tangent = (pts[i + 1] - pts[i - 1]).normalized()
			u = (u - tangent * u.dot(tangent)).normalized()
			var v := tangent.cross(u).normalized()
			var ring := PackedVector3Array()
			for k in range(radial):
				var a: float = TAU * float(k) / float(radial)
				ring.append(pts[i] + (u * cos(a) + v * sin(a)) * radii[i])
			rings.append(ring)

		# Connect consecutive rings.
		for i in range(ring_count - 1):
			var ra: PackedVector3Array = rings[i]
			var rb: PackedVector3Array = rings[i + 1]
			var va: float = float(i) / float(ring_count - 1)
			var vb: float = float(i + 1) / float(ring_count - 1)
			for k in range(radial):
				var k2: int = (k + 1) % radial
				var ua: float = float(k) / float(radial)
				var ub: float = float(k + 1) / float(radial)
				_quad(st,
					ra[k], Vector2(ua, va),
					ra[k2], Vector2(ub, va),
					rb[k2], Vector2(ub, vb),
					rb[k], Vector2(ua, vb))

		# Tip cap: fan from last ring to a point just past the tip.
		var last_ring: PackedVector3Array = rings[ring_count - 1]
		var tip_dir := (pts[ring_count - 1] - pts[ring_count - 2]).normalized()
		var tip := pts[ring_count - 1] + tip_dir * radii[ring_count - 1] * 1.5
		for k in range(radial):
			var k2: int = (k + 1) % radial
			st.set_uv(Vector2(0.5, 1.0))
			st.add_vertex(last_ring[k])
			st.set_uv(Vector2(0.5, 1.0))
			st.add_vertex(tip)
			st.set_uv(Vector2(0.5, 1.0))
			st.add_vertex(last_ring[k2])

	st.generate_normals()
	return st.commit()


static func _quad(
		st: SurfaceTool,
		p0: Vector3, uv0: Vector2, p1: Vector3, uv1: Vector2,
		p2: Vector3, uv2: Vector2, p3: Vector3, uv3: Vector2
	) -> void:
	# Godot front faces are CLOCKWISE — wind so outward normals survive culling.
	st.set_uv(uv0); st.add_vertex(p0)
	st.set_uv(uv2); st.add_vertex(p2)
	st.set_uv(uv1); st.add_vertex(p1)
	st.set_uv(uv0); st.add_vertex(p0)
	st.set_uv(uv3); st.add_vertex(p3)
	st.set_uv(uv2); st.add_vertex(p2)


# ---------------------------------------------------------------- leaf mesh

const CARD_CORNERS: Array[Vector2] = [
	Vector2(-0.5, -0.5), Vector2(0.5, -0.5),
	Vector2(0.5, 0.5), Vector2(-0.5, 0.5),
]
const CARD_TRIS: Array[int] = [0, 1, 2, 0, 2, 3]


## Cheap distant stand-in: a handful of big leaf cards filling the canopy
## volume (derived from the real cluster centers), using the same vertex
## contract + atlas as the full mesh so it blends in at range. ~36 verts vs
## thousands — this is the forest LOD's far tier.
static func build_impostor(
		centers: PackedVector3Array, atlas_cells: int,
		rng: RandomNumberGenerator, card_count: int = 14
	) -> ArrayMesh:
	if centers.is_empty():
		return ArrayMesh.new()

	var lo: Vector3 = centers[0]
	var hi: Vector3 = centers[0]
	for c in centers:
		lo.x = minf(lo.x, c.x); lo.y = minf(lo.y, c.y); lo.z = minf(lo.z, c.z)
		hi.x = maxf(hi.x, c.x); hi.y = maxf(hi.y, c.y); hi.z = maxf(hi.z, c.z)
	var center: Vector3 = (lo + hi) * 0.5
	var radius: float = maxf(maxf(hi.x - lo.x, hi.z - lo.z) * 0.5, 1.0)
	var height: float = maxf(hi.y - lo.y, 1.0)
	var y_min: float = lo.y
	var y_span: float = maxf(hi.y - lo.y, 0.001)
	var cells: int = maxi(1, atlas_cells)
	var inset: float = 0.94

	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for _i in range(card_count):
		var pos := center + Vector3(
			rng.randf_range(-1.0, 1.0) * radius * 0.85,
			rng.randf_range(-0.5, 0.5) * height * 0.7,
			rng.randf_range(-1.0, 1.0) * radius * 0.85)
		var size: float = radius * rng.randf_range(1.35, 1.85)
		var height_t: float = clampf((pos.y - y_min) / y_span, 0.0, 1.0)
		var phase: float = rng.randf()
		var roll: float = rng.randf()
		var depth_key: float = rng.randf()
		var cell: int = rng.randi_range(0, cells * cells - 1)
		var cx: int = cell % cells
		var cy: int = floori(float(cell) / float(cells))
		for idx in CARD_TRIS:
			var corner: Vector2 = CARD_CORNERS[idx]
			var uv := Vector2(
				(float(cx) + 0.5 + corner.x * inset) / float(cells),
				(float(cy) + 0.5 - corner.y * inset) / float(cells))
			st.set_uv(uv)
			st.set_uv2(corner * size)
			st.set_color(Color(phase, height_t, roll, depth_key))
			st.set_normal(Vector3.UP)
			st.add_vertex(pos)
	return st.commit()


## Cheap far-LOD trunk: one tapered low-poly vertical tube. Far trees should not
## keep their full branch skeleton; this gives the impostor a grounded silhouette
## for a few dozen vertices.
static func build_trunk_impostor(params: Dictionary) -> ArrayMesh:
	var p: Dictionary = DEFAULTS.duplicate()
	for k in params.keys():
		p[k] = params[k]

	var height: float = float(p["trunk_height"]) * 0.85
	var base_r: float = maxf(float(p["trunk_radius"]) * 1.15, 0.06)
	var top_r: float = base_r * 0.32
	var radial := 5

	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)

	var base := PackedVector3Array()
	var top := PackedVector3Array()
	for k in range(radial):
		var a: float = TAU * float(k) / float(radial)
		var dir := Vector3(cos(a), 0.0, sin(a))
		base.append(dir * base_r)
		top.append(Vector3(0.0, height, 0.0) + dir * top_r)

	for k in range(radial):
		var k2: int = (k + 1) % radial
		var u0: float = float(k) / float(radial)
		var u1: float = float(k + 1) / float(radial)
		_quad(st,
			base[k], Vector2(u0, 0.0),
			base[k2], Vector2(u1, 0.0),
			top[k2], Vector2(u1, 1.0),
			top[k], Vector2(u0, 1.0))

	st.generate_normals()
	return st.commit()


static func _build_leaf_mesh(
		clusters: Array, p: Dictionary, atlas_cells: int,
		rng: RandomNumberGenerator
	) -> ArrayMesh:
	if clusters.is_empty():
		return ArrayMesh.new()

	var y_min: float = INF
	var y_max: float = -INF
	for c in clusters:
		var y: float = (c["center"] as Vector3).y
		y_min = minf(y_min, y)
		y_max = maxf(y_max, y)
	var y_span: float = maxf(y_max - y_min, 0.001)

	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)

	var card_size: float = float(p["leaf_card_size"])
	var jitter: float = float(p["leaf_size_jitter"])
	var per_cluster: int = maxi(1, int(p["leaves_per_cluster"]))
	var cluster_r: float = float(p["cluster_radius"])
	var cells: int = maxi(1, atlas_cells)
	var inset: float = 0.94   # shrink cell UVs to dodge atlas bleed
	var flatten: float = clampf(float(p["cluster_flatten"]), 0.0, 0.95)

	for c in clusters:
		var center: Vector3 = c["center"]
		for _i in range(per_cluster):
			var off := Vector3(
				rng.randf_range(-1.0, 1.0),
				rng.randf_range(-0.7, 0.7) * (1.0 - flatten),
				rng.randf_range(-1.0, 1.0)
			) * cluster_r
			var pos := center + off
			var size: float = card_size * (1.0 + rng.randf_range(-jitter, jitter))
			var height_t: float = clampf((pos.y - y_min) / y_span, 0.0, 1.0)
			var phase: float = rng.randf()
			# Per-card roll → varied billboard orientation (expanded in-shader).
			var roll: float = rng.randf()
			# Independent per-card key (vertex COLOR.a) → depth stratification
			# so coplanar camera-facing cards don't z-fight.
			var depth_key: float = rng.randf()

			var cell: int = rng.randi_range(0, cells * cells - 1)
			var cx: int = cell % cells
			var cy: int = floori(float(cell) / float(cells))

			# All four corners share the card center; the shader builds a
			# camera-facing quad from UV2, so cards never go edge-on.
			for idx in CARD_TRIS:
				var corner: Vector2 = CARD_CORNERS[idx]
				var uv := Vector2(
					(float(cx) + 0.5 + corner.x * inset) / float(cells),
					(float(cy) + 0.5 - corner.y * inset) / float(cells))
				st.set_uv(uv)
				st.set_uv2(corner * size)
				st.set_color(Color(phase, height_t, roll, depth_key))
				st.set_normal(Vector3.UP)
				st.add_vertex(pos)

	return st.commit()
