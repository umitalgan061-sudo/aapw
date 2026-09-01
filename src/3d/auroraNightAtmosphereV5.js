/**
 * Final Run221 night-atmosphere calibration plus full-world lower-hemisphere marine continuity.
 *
 * V4's irregular ray curtains passed visual review, but full-world orthographic proof exposed a
 * separate shipped-runtime composition problem: finite world-anchored marine planes can end inside
 * the camera frustum and reveal the camera-relative lower sky as a sharply different rectangular
 * colour family.
 *
 * The previous V5 correction finally patched the real V4 `skyColor` composition target, but still
 * multiplied the marine-floor mask by `uNightFactor`. That made the P0 continuity correction vanish
 * during daylight/twilight proof captures even though the finite water footprint remains present at
 * every time of day. This revision makes the below-horizon marine floor lighting-independent while
 * preserving a narrow release band around the horizon. Geography, hydrology, water coverage, day
 * horizon colour and auroral geometry remain untouched.
 */

import { GEOGRAPHIC_REFERENCE_PALETTE } from './world/geographicReferencePalette.js';

function rgbTripletFromHex(hex) {
	return Object.freeze([
		((hex >> 16) & 0xff) / 255,
		((hex >> 8) & 0xff) / 255,
		(hex & 0xff) / 255,
	]);
}

const MARINE_NIGHT_FLOOR_RGB = rgbTripletFromHex(GEOGRAPHIC_REFERENCE_PALETTE.water.deepSea);

export const WORLD_SKY_MARINE_FLOOR_POLICY = Object.freeze({
	id: 'camera-relative-marine-lower-hemisphere-continuity-v4-all-lighting',
	renderOnly: true,
	cameraRelative: true,
	canonicalGeographyUnchanged: true,
	canonicalWaterCoverageUnchanged: true,
	finiteWaterFootprintSafe: true,
	blackBackgroundFallback: false,
	sharedDeepSeaPalette: true,
	explicitBelowHorizonBlend: true,
	allLightingContinuity: true,
	blendFullBelowDirectionY: -0.16,
	blendReleasedDirectionY: 0.035,
	marineNightFloorRgb: MARINE_NIGHT_FLOOR_RGB,
});

export function applyAuroraNightAtmosphereV5(material) {
	const marineFloor = WORLD_SKY_MARINE_FLOOR_POLICY.marineNightFloorRgb
		.map((value) => value.toFixed(4))
		.join(', ');

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
			'vec3 skyColor = mix(canonicalSky, deepSky, deepBlend);',
			`vec3 skyColor = mix(canonicalSky, deepSky, deepBlend);\n\t\tfloat marineFloorMask = 1.0 - smoothstep(${WORLD_SKY_MARINE_FLOOR_POLICY.blendFullBelowDirectionY.toFixed(3)}, ${WORLD_SKY_MARINE_FLOOR_POLICY.blendReleasedDirectionY.toFixed(3)}, dir.y);\n\t\tvec3 marineNightFloor = vec3(${marineFloor});\n\t\tskyColor = mix(skyColor, marineNightFloor, marineFloorMask);`,
		)
		.replace(
			'finalColor += oxygenGreen * haze * 0.10;',
			'finalColor += oxygenGreen * haze * 0.11;',
		);
	material.needsUpdate = true;
	material.userData.auroraNightAtmosphereV5 = true;
	material.userData.worldSkyMarineFloorPolicy = WORLD_SKY_MARINE_FLOOR_POLICY;
	return material;
}
