// Bark shader with LOD dissolve, paired with leaf_atlas.gdshader.
//
// Mirrors the old StandardMaterial3D bark (flat albedo color, optional
// triplanar albedo texture, roughness 1.0) but adds the same screen-door
// dither cross-fade the leaves use, driven by MultiMesh INSTANCE_CUSTOM.r.
// This lets the wood tier (full branches <-> cheap trunk impostor) cross-fade
// in lockstep with the canopy instead of hard-popping at the LOD distance.
//
// Opaque + depth-writing (dither, not alpha-blend) so it stays MultiMesh- and
// web-export (GL Compatibility) safe and keeps casting trunk shadows.
shader_type spatial;

uniform vec3 bark_color : source_color = vec3(0.38, 0.27, 0.18);
uniform sampler2D bark_texture : source_color, filter_linear_mipmap, hint_default_white;
uniform bool use_texture = false;
uniform float texture_scale = 1.0;

varying vec3 v_lod;          // r = blend, g = far-tier flag, b = LOD-active flag
varying vec3 v_world_pos;
varying vec3 v_world_normal;

const float LOD_BAYER[16] = float[](
	0.0  / 16.0, 8.0  / 16.0, 2.0  / 16.0, 10.0 / 16.0,
	12.0 / 16.0, 4.0  / 16.0, 14.0 / 16.0, 6.0  / 16.0,
	3.0  / 16.0, 11.0 / 16.0, 1.0  / 16.0, 9.0  / 16.0,
	15.0 / 16.0, 7.0  / 16.0, 13.0 / 16.0, 5.0  / 16.0);

void vertex() {
	v_lod = INSTANCE_CUSTOM.rgb;
	v_world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_world_normal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	// Complementary screen-door LOD cross-fade in lockstep with the leaves.
	// Only LOD-active instances (custom.b = 1) dither; plain meshes stay solid.
	if (v_lod.b > 0.5) {
		float th = LOD_BAYER[int(mod(FRAGCOORD.x, 4.0)) + int(mod(FRAGCOORD.y, 4.0)) * 4];
		float blend = clamp(v_lod.r, 0.0, 1.0);
		if (v_lod.g > 0.5) {
			if (th < blend) discard;        // far tier (trunk impostor)
		} else {
			if (th >= blend) discard;       // near tier (full branches)
		}
	}

	vec3 col = bark_color;
	if (use_texture) {
		// Cheap triplanar so the procedural trunk tubes don't show UV seams,
		// matching StandardMaterial3D.uv1_triplanar.
		vec3 bw = abs(v_world_normal);
		bw /= max(bw.x + bw.y + bw.z, 0.0001);
		vec2 uv_x = v_world_pos.zy * texture_scale;
		vec2 uv_y = v_world_pos.xz * texture_scale;
		vec2 uv_z = v_world_pos.xy * texture_scale;
		vec3 tex = texture(bark_texture, uv_x).rgb * bw.x
			+ texture(bark_texture, uv_y).rgb * bw.y
			+ texture(bark_texture, uv_z).rgb * bw.z;
		// The texture IS the bark look — use it directly rather than
		// multiplying by the (dark) flat fallback colour, which would crush the
		// detail to near-black. Lighting sets the mood.
		col = tex;
	}

	ALBEDO = col;
	ROUGHNESS = 1.0;
	METALLIC = 0.0;
}
