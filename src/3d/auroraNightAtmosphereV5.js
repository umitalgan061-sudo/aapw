/**
 * Final Run221 night-atmosphere calibration.
 *
 * V4's irregular ray curtains passed visual review, but the lower night sky beneath the auroral
 * arc remained too close to black. This additive layer changes only the V4 shader's atmospheric
 * floor constants after V4 is installed; curtain geometry, ray density, animation and colors stay
 * untouched. The result should read as moonlit deep-blue night rather than daylight or black void.
 */
export function applyAuroraNightAtmosphereV5(material) {
	material.fragmentShader = material.fragmentShader
		.replace(
			'vec3 deepHorizon = vec3(0.018, 0.042, 0.086);',
			'vec3 deepHorizon = vec3(0.050, 0.092, 0.165);',
		)
		.replace(
			'vec3 deepZenith = vec3(0.0035, 0.009, 0.027);',
			'vec3 deepZenith = vec3(0.009, 0.020, 0.052);',
		)
		.replace(
			'finalColor += oxygenGreen * haze * 0.10;',
			'finalColor += oxygenGreen * haze * 0.11;',
		);
	material.needsUpdate = true;
	material.userData.auroraNightAtmosphereV5 = true;
	return material;
}
