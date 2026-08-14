// Binbun Water (basic) — web için düzleştirilmiş sürüm.
// Etkin: caustics + refraction + displacement + GL Compatibility NDC derinlik
// eşlemesi. Stylized lighting ve unshaded yolları bu oyunda kapalı.
shader_type spatial;
render_mode depth_draw_never;

uniform sampler2D DEPTH_TEXTURE: hint_depth_texture;

group_uniforms Color;
uniform vec4 surface_color : source_color = vec4(0.2,1.0,0.8,1.0);
uniform vec4 depth_color : source_color = vec4(0.08,0.2,0.4,1.0);
uniform vec4 foam_color : source_color = vec4(1.0);
uniform float depth_size = 12.0;

group_uniforms Roughness;
uniform float surface_roughness : hint_range(0.0, 1.0, 0.01) = 0.05;
uniform float foam_roughness : hint_range(0.0, 1.0, 0.01) = 0.05;

group_uniforms Caustics;
uniform sampler2D caustics_texture;
uniform float caustics_strength = 2.0;
uniform vec2 caustics_scale = vec2(0.5);

group_uniforms Wave;
uniform sampler2D wave_texture;
uniform sampler2D wave_normal_texture;
uniform float wave_softness : hint_range(0.0, 10.0, 0.1) = 3.0;
uniform vec2 wave_scale = vec2(0.2);
uniform vec2 wave_layer_scale = vec2(1.5);
uniform float wave_highlight : hint_range(0.0, 1.0, 0.05) = 0.5;

group_uniforms Wave.Motion;
uniform vec2 wave_velocity = vec2(0.02);

group_uniforms Foam;
uniform sampler2D foam_texture;
uniform float edge_foam_depth_size = 1.0;
uniform float wave_foam_amount : hint_range(0.0, 1.0, 0.01) = 0.8;
uniform float foam_start : hint_range(0.0, 1.0, 0.05) = 0.15;
uniform float foam_end : hint_range(0.0, 1.0, 0.05) = 0.3;
uniform float foam_exponent = 2.0;

group_uniforms Refraction;
uniform float refraction_amount = 0.5;
uniform float refraction_exponent = 0.5;

group_uniforms Displacement;
uniform float displacement_amount = 0.3;

uniform sampler2D screen_texture : hint_screen_texture;
varying vec3 world_pos;

vec3 sample_caustics(vec2 uv){
	vec2 caustics_uv = uv * caustics_scale;
	return vec3(
		texture(caustics_texture, caustics_uv).r,
		texture(caustics_texture, caustics_uv+vec2(0.02,0.02)).r,
		texture(caustics_texture, caustics_uv+vec2(0.03,0.01)).r
	);
}

vec4 sample_world_dpos(vec2 screen_uv, mat4 inv_proj_mat, mat4 inv_view_mat){
	float depth = texture(DEPTH_TEXTURE, screen_uv).r;
	// GL Compatibility: NDC z aralığı [-1,1] — derinlik remap gerekli.
	depth = depth * 2.0 - 1.0;
	vec4 clip_pos = vec4(screen_uv * 2.0 - 1.0, depth, 1.0);
	vec4 view_pos = inv_proj_mat * clip_pos;
	view_pos /= view_pos.w;
	vec4 world_dpos = inv_view_mat * view_pos;
	return world_dpos;
}

vec4 sample_wave(sampler2D tex, vec2 uv, vec2 velocity, float lod){
	vec2 base_uv = uv * wave_scale;
	vec2 wave_uv1 = (base_uv * wave_layer_scale) + (TIME * -velocity);
	float wave1 = textureLod(tex, wave_uv1, lod).r;

	vec2 wave_uv2 = base_uv + (TIME * velocity);
	vec4 wave2 = textureLod(tex, wave_uv2 - (wave1 * 0.1), lod);

	return wave2;
}

void vertex(){
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float wave = sample_wave(wave_texture, world_pos.xz, wave_velocity, wave_softness).r;
	VERTEX.y += wave*displacement_amount;
}

void fragment() {
	float wave = sample_wave(wave_texture, world_pos.xz, wave_velocity, wave_softness).r;
	wave = smoothstep(0.0,1.0,wave);

	vec2 screen_uv = SCREEN_UV;

	// Refraction
	screen_uv += ((pow(wave, refraction_exponent)*2.0 - 0.5) * 0.01 * refraction_amount);

	vec4 world_dpos = sample_world_dpos(screen_uv, INV_PROJECTION_MATRIX, INV_VIEW_MATRIX);

	float pre_depth = pow(clamp((world_dpos.y - world_pos.y + depth_size)/depth_size, 0.0, 1.0), 4.0);
	screen_uv = mix(screen_uv, SCREEN_UV, pre_depth);
	if(world_dpos.y - world_pos.y > 0.0){
		screen_uv = SCREEN_UV;
	}

	world_dpos = sample_world_dpos(screen_uv, INV_PROJECTION_MATRIX, INV_VIEW_MATRIX);

	vec2 surface_uv = world_dpos.xz * 0.2;

	float depth = pow(clamp((world_dpos.y - world_pos.y + depth_size)/depth_size, 0.0, 1.0), 4.0);

	// Caustics
	vec3 caustics1 = sample_caustics(surface_uv + (TIME * -wave_velocity));
	vec3 caustics2 = sample_caustics((surface_uv + (caustics1.r*0.05)) + (TIME * (wave_velocity*0.5)));
	vec3 caustics = caustics2 * (1.0 - depth);

	// Edge Foam
	float edge_foam_depth = clamp((world_dpos.y - world_pos.y + edge_foam_depth_size)/edge_foam_depth_size, 0.0, 1.0);

	// Wave Foam
	float wave_foam = wave;
	float foam = max(edge_foam_depth, wave_foam * wave_foam_amount);

	float foam_shape = 1.0 - texture(foam_texture, world_pos.xz* 0.5).r;
	foam = clamp((foam - foam_start) / (foam_end - foam_start), 0.0, 1.0);
	foam = clamp((foam - foam_shape) / (1.0 - foam_shape), 0.0, 1.0);
	foam = pow(foam, foam_exponent);

	vec3 flat_color = mix(depth_color, surface_color, depth).rgb;

	vec4 screen = texture(screen_texture, screen_uv);
	vec3 color = screen.rgb;
	color += vec3(pow(caustics * caustics_strength, vec3(2.0)));
	color = mix(flat_color, color, 0.4 * depth);
	color = mix(color, surface_color.rgb, wave * wave_highlight);
	color = mix(color, foam_color.rgb, foam);

	vec3 wave_normal_map = sample_wave(wave_normal_texture, world_pos.xz, wave_velocity, wave_softness).rgb;
	NORMAL_MAP = wave_normal_map;

	ROUGHNESS = mix(surface_roughness, foam_roughness, foam);

	ALBEDO = color;
}
