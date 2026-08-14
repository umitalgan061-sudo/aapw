shader_type spatial;
render_mode cull_disabled, diffuse_burley, specular_schlick_ggx, world_vertex_coords;

uniform sampler2D leaf_atlas : source_color, filter_linear_mipmap_anisotropic;
uniform float alpha_threshold : hint_range(0.0, 1.0) = 0.42;
uniform float billboard_strength : hint_range(0.0, 1.0) = 0.28;
uniform float card_tilt : hint_range(0.0, 1.0) = 0.36;
uniform float card_depth_spread : hint_range(0.0, 1.5) = 0.32;
uniform vec3 tint_color : source_color = vec3(0.76, 0.86, 0.70);
uniform float tint_strength : hint_range(0.0, 1.0) = 0.24;
uniform float bottom_darken : hint_range(0.0, 1.0) = 0.42;
uniform bool use_wind = true;
uniform float wind_strength : hint_range(0.0, 1.0) = 0.08;
uniform float wind_speed : hint_range(0.0, 5.0) = 0.72;
uniform vec3 wind_direction = vec3(0.9, 0.0, 0.32);

varying float v_height;
varying vec3 v_lod;

void vertex() {
	vec3 cam_right = normalize(INV_VIEW_MATRIX[0].xyz);
	vec3 cam_up = normalize(INV_VIEW_MATRIX[1].xyz);
	vec3 cam_fwd = normalize(INV_VIEW_MATRIX[2].xyz);
	vec3 world_up = vec3(0.0, 1.0, 0.0);
	vec3 cylindrical_right = normalize(cross(world_up, cam_fwd));
	vec3 right = normalize(mix(cylindrical_right, cam_right, billboard_strength));
	vec3 up = normalize(mix(world_up, cam_up, billboard_strength));

	float roll = COLOR.b * 6.2831853;
	float cr = cos(roll);
	float sr = sin(roll);
	vec2 offset = vec2(UV2.x * cr - UV2.y * sr, UV2.x * sr + UV2.y * cr);
	vec3 corner = right * offset.x + up * offset.y;
	float tilt = (offset.x * (COLOR.a - 0.5) + offset.y * (COLOR.b - 0.5)) * card_tilt;
	VERTEX += corner + cam_fwd * tilt;

	if (use_wind) {
		float phase = COLOR.r * 6.2831853;
		float canopy = 0.25 + 0.75 * COLOR.g;
		float gust = sin(TIME * wind_speed * 0.55 + COLOR.g * 1.7);
		float rustle = sin(TIME * wind_speed * 2.1 + phase) * 0.35;
		VERTEX += normalize(wind_direction) * (gust + rustle) * wind_strength * canopy;
	}

	VERTEX += cam_fwd * (COLOR.a - 0.5) * card_depth_spread;
	v_height = COLOR.g;
	v_lod = INSTANCE_CUSTOM.rgb;
	NORMAL = normalize(mix(world_up, -cam_fwd, 0.16));
}

void fragment() {
	if (v_lod.b > 0.5) {
		float threshold = fract(sin(dot(floor(FRAGCOORD.xy), vec2(12.9898, 78.233))) * 43758.5453);
		float blend = clamp(v_lod.r, 0.0, 1.0);
		if (v_lod.g > 0.5) {
			if (threshold < blend) discard;
		} else if (threshold >= blend) {
			discard;
		}
	}

	vec4 tex = texture(leaf_atlas, UV);
	vec3 foliage = tex.rgb * mix(vec3(1.0), tint_color, tint_strength);
	foliage *= mix(1.0 - bottom_darken, 1.0, v_height);
	ALBEDO = foliage;
	ROUGHNESS = 0.86;
	SPECULAR = 0.22;
	BACKLIGHT = foliage * 0.18;
	ALPHA = tex.a;
	ALPHA_SCISSOR_THRESHOLD = alpha_threshold;
}
