/**
 * Final Run221 night-atmosphere calibration.
 *
 * V4's irregular ray curtains passed visual review, but the lower night sky beneath the auroral
 * arc remained too close to black. This additive layer changes only the V4 shader's atmospheric
 * floor constants after V4 is installed; curtain geometry, ray density, animation and colors stay
 * untouched. The result should read as moonlit deep-blue night rather than daylight or black void.
 *
 * The current realism pass also removes the remaining perfectly smooth night-sky gradient. It uses
 * V4's already deterministic multi-scale FBM in view/sky space to add very low-amplitude upper-air
 * extinction, broad moonlit haze and a restrained blue-green airglow band. This is render-only: it
 * does not alter terrain, hydrology, colliders, landmark placement, or any canonical map authority.
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
			'float t = uTime;',
			`float t = uTime;
		float upperAirMacro = ray4Fbm(vec2(azimuth * 1.37 + t * 0.00035, elevation * 1.65 - t * 0.00021));
		float upperAirMeso = ray4Fbm(vec2(azimuth * 4.90 - t * 0.00082, elevation * 3.40 + 13.7));
		float horizonMoisture = (1.0 - smoothstep(0.10, 0.43, elevation))
			* smoothstep(0.34, 0.78, upperAirMacro * 0.68 + upperAirMeso * 0.32);
		float extinction = (upperAirMacro - 0.5) * 0.050 + (upperAirMeso - 0.5) * 0.018;
		float airglowBand = smoothstep(0.08, 0.20, elevation)
			* (1.0 - smoothstep(0.43, 0.72, elevation))
			* smoothstep(0.37, 0.76, ray4Fbm(vec2(azimuth * 2.30 + 21.1, elevation * 2.10 - t * 0.00018)));
		skyColor *= 1.0 + extinction * uNightFactor;
		skyColor = mix(skyColor, vec3(0.060, 0.115, 0.175), horizonMoisture * 0.115 * uNightFactor);
		skyColor += vec3(0.012, 0.032, 0.030) * airglowBand * uNightFactor;`,
		)
		.replace(
			'finalColor += oxygenGreen * haze * 0.10;',
			'finalColor += oxygenGreen * haze * 0.11;',
		);
	material.needsUpdate = true;
	material.userData.auroraNightAtmosphereV5 = true;
	material.userData.nightAtmosphereRealism = Object.freeze({
		version: 6,
		deterministicMultiscaleUpperAir: true,
		uniformGradientRemoved: true,
		moonlitHorizonMoisture: true,
		restrainedAirglowBand: true,
		geographyAuthorityChanged: false,
	});
	return material;
}
