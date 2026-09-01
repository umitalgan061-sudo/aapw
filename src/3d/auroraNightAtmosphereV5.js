/**
 * Final Run221 night-atmosphere calibration.
 *
 * V4 owns curtain morphology; V5 only calibrates the deep-night atmospheric floor and restrained
 * aurora haze after that final shader is installed. Every replacement is required: a future V4
 * source change must fail loudly here instead of silently setting the V5 marker on a partially
 * patched shader.
 */
function replaceRequired(source, from, to, label) {
	if (!source.includes(from)) {
		throw new Error(`[auroraNightAtmosphereV5] required V4 token missing: ${label}`);
	}
	return source.replace(from, to);
}

export function applyAuroraNightAtmosphereV5(material) {
	let shader = material.fragmentShader;
	shader = replaceRequired(
		shader,
		'vec3 deepHorizon = vec3(0.018, 0.042, 0.086);',
		'vec3 deepHorizon = vec3(0.050, 0.092, 0.165);',
		'deep-horizon floor',
	);
	shader = replaceRequired(
		shader,
		'vec3 deepZenith = vec3(0.0035, 0.009, 0.027);',
		'vec3 deepZenith = vec3(0.009, 0.020, 0.052);',
		'deep-zenith floor',
	);
	shader = replaceRequired(
		shader,
		'finalColor += oxygenGreen * haze * 0.078;',
		'finalColor += oxygenGreen * haze * 0.084;',
		'aurora haze calibration',
	);

	material.fragmentShader = shader;
	material.needsUpdate = true;
	material.userData.auroraNightAtmosphereV5 = true;
	material.userData.auroraNightCalibration = 'required-token-deep-blue-v6';
	return material;
}
