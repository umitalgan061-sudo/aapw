// Atlas-aware stylized foliage shader.
//
// Descendant of tree_sway.gdshader (meadow-explorer FluffyTrees), reworked
// for leaf-atlas textures:
//   - UV  = atlas cell rect → texture sampling (RGBA, real alpha channel)
//   - UV2 = card-corner offset in world units → billboard puff math
//     (the original used `UV - 0.5`, which breaks once UV points at a cell)
//   - COLOR.r = per-card wind phase, COLOR.g = canopy height 0..1
//
// Alpha scissor (NOT blend) → opaque, depth-writing, MultiMesh- and web-safe.
shader_type spatial;
// world_vertex_coords → VERTEX is world space, so the billboard can use the
// camera axes straight from INV_VIEW_MATRIX with NO per-vertex matrix inverse
// (the old inverse(MODELVIEW) ran on every leaf vertex of every tree). This is
// both Godot's recommended foliage setup and a large vertex-shader saving.
render_mode cull_disabled, diffuse_toon, specular_disabled, world_vertex_coords;

uniform sampler2D leaf_atlas : source_color, filter_linear_mipmap;
uniform float alpha_threshold : hint_range(0.0, 1.0) = 0.45;
uniform float billboard_strength : hint_range(0.0, 1.0) = 0.35;
// Per-card tilt OUT of the view plane. Coplanar camera-facing cards share a
// depth plane and z-fight; tilting each card so overlaps intersect at an angle
// gives the depth test a stable winner (this is the real flicker fix).
uniform float card_tilt : hint_range(0.0, 1.0) = 0.5;
// Coarse per-card depth stratification so card CENTERS don't coincide either.
uniform float card_depth_spread : hint_range(0.0, 1.5) = 0.4;

uniform vec3 tint_color : source_color = vec3(1.0, 1.0, 1.0);
uniform float tint_strength : hint_range(0.0, 1.0) = 0.0;
uniform float bottom_darken : hint_range(0.0, 1.0) = 0.35;

uniform float fresnel_strength : hint_range(0.0, 1.0) = 0.12;
uniform float fresnel_power : hint_range(0.1, 5.0) = 1.7;
uniform vec3 fresnel_colour : source_color = vec3(0.85, 1.0, 0.7);

uniform bool use_wind = true;
uniform float wind_strength : hint_range(0.0, 1.0) = 0.12;
uniform float wind_speed : hint_range(0.0, 5.0) = 1.4;
uniform vec3 wind_direction = vec3(1.0, 0.0, 0.3);

varying float v_height;
// Per-instance LOD cross-fade, read from MultiMesh INSTANCE_CUSTOM:
//   r = blend (1 = fully near/full-detail, 0 = fully far/impostor)
//   g = tier flag (0 = near tier, 1 = far tier)
//   b = LOD-active flag (1 = participate in the dither cross-fade)
// Defaults to (0,0,0) for plain meshes / MultiMeshes without custom data, so
// single trees and backdrops keep b=0 and are never dithered (always solid).
varying vec3 v_lod;

// Ordered 4x4 Bayer threshold map. Screen-door (stable, opaque, web-safe)
// dither: a stochastic alpha fade that keeps the leaves depth-writing and
// shadow-casting (unlike alpha-blend), so it works with MultiMesh + GL
// Compatibility exactly like the existing alpha-scissor path.
const float LOD_BAYER[16] = float[](
	0.0  / 16.0, 8.0  / 16.0, 2.0  / 16.0, 10.0 / 16.0,
	12.0 / 16.0, 4.0  / 16.0, 14.0 / 16.0, 6.0  / 16.0,
	3.0  / 16.0, 11.0 / 16.0, 1.0  / 16.0, 9.0  / 16.0,
	15.0 / 16.0, 7.0  / 16.0, 13.0 / 16.0, 5.0  / 16.0);

void vertex() {
	// Leaf cards are camera-facing billboards: every corner shares the card
	// CENTER as VERTEX, and UV2 is the 2D corner offset. Expanding the card
	// along camera axes is what stops it collapsing to an invisible sliver
	// when its plane lines up with the view direction.
	vec3 cam_right = normalize(INV_VIEW_MATRIX[0].xyz);
	vec3 cam_up    = normalize(INV_VIEW_MATRIX[1].xyz);
	vec3 cam_fwd   = normalize(INV_VIEW_MATRIX[2].xyz);
	// strength 0 = cylindrical (leaves stay upright, only yaw to camera),
	// strength 1 = spherical (fully face the camera, never thin out).
	vec3 world_up  = vec3(0.0, 1.0, 0.0);
	vec3 cyl_right = normalize(cross(world_up, cam_fwd));
	vec3 right = normalize(mix(cyl_right, cam_right, billboard_strength));
	vec3 up    = normalize(mix(world_up,  cam_up,    billboard_strength));

	// Per-card roll (COLOR.b) keeps billboards from all aligning, restoring
	// the variety the old random card orientation used to provide.
	float roll = COLOR.b * 6.2831853;
	float cr = cos(roll);
	float sr = sin(roll);
	vec2 off2 = vec2(UV2.x * cr - UV2.y * sr, UV2.x * sr + UV2.y * cr);
	// Build the camera-facing quad, then tilt it slightly out of the view
	// plane by a per-card amount. Non-coplanar cards intersect at stable
	// angles instead of sharing a depth plane and flickering — exactly how
	// the old random-3D-oriented cards stayed stable, but without the edge-on
	// vanishing (the tilt is small, so projected area stays large).
	vec3 corner = right * off2.x + up * off2.y;
	float tilt = (off2.x * (COLOR.a - 0.5) + off2.y * (COLOR.b - 0.5)) * card_tilt;
	corner += cam_fwd * tilt;
	VERTEX += corner;

	if (use_wind) {
		float phase = COLOR.r * 6.2831853;
		float t = TIME * wind_speed;
		// Canopy top moves more than inner/lower leaves.
		float canopy = 0.35 + 0.65 * COLOR.g;

		// Soft shared gust: the whole canopy leans together, slow and smooth
		// (low frequency, no sharp pulse).
		float gust = sin(t * 0.6 + COLOR.g * 1.5);
		VERTEX += normalize(wind_direction) * gust * wind_strength * canopy * 0.6;

		// Per-card rustle: each card trembles in its OWN direction (derived
		// from its phase) at two frequencies, so cards don't move in lockstep
		// the way they would now that they all face the camera.
		vec3 cdir = normalize(vec3(sin(phase), 0.3, cos(phase * 1.3)));
		float rustle = sin(t * 1.7 + phase) + 0.4 * sin(t * 3.3 + phase * 2.1);
		VERTEX += cdir * rustle * wind_strength * canopy * 0.5;
	}

	// Stable per-card depth stratification: shift each card along the view
	// axis by a constant amount keyed on COLOR.a. Overlapping cards land on
	// separate depth slices, so the depth test stops flip-flopping (the cause
	// of the in-tree z-fighting and leaves popping under wind).
	VERTEX += cam_fwd * (COLOR.a - 0.5) * card_depth_spread;

	v_height = COLOR.g;
	v_lod = INSTANCE_CUSTOM.rgb;
	// Up-facing normal → soft, even canopy lighting (grass-shader trick).
	NORMAL = vec3(0.0, 1.0, 0.0);
}

void fragment() {
	// Complementary screen-door LOD cross-fade. Only instances the forest LOD
	// marks active (custom.b = 1) dither; plain meshes / single trees keep
	// b = 0 and stay fully solid. The near and far tiers use opposite halves
	// of the same dither pattern, so together they always cover 100% of pixels
	// with no holes and no overlap (the fix for the old "speckled/disappearing"
	// look). blend 1 = full near, 0 = full far.
	if (v_lod.b > 0.5) {
		float th = LOD_BAYER[int(mod(FRAGCOORD.x, 4.0)) + int(mod(FRAGCOORD.y, 4.0)) * 4];
		float blend = clamp(v_lod.r, 0.0, 1.0);
		if (v_lod.g > 0.5) {
			if (th < blend) discard;        // far tier keeps high-threshold pixels
		} else {
			if (th >= blend) discard;       // near tier keeps low-threshold pixels
		}
	}

	vec4 tex = texture(leaf_atlas, UV);
	vec3 col = tex.rgb * mix(vec3(1.0), tint_color, tint_strength);
	col *= mix(1.0 - bottom_darken, 1.0, v_height);

	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), fresnel_power);
	col = mix(col, fresnel_colour, fres * fresnel_strength);

	ALBEDO = col;
	ROUGHNESS = 0.95;
	ALPHA = tex.a;
	ALPHA_SCISSOR_THRESHOLD = alpha_threshold;
}
