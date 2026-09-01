/**
 * Final Run221 night-atmosphere calibration plus the full-world lower-hemisphere continuity fix.
 *
 * V4's irregular ray curtains passed visual review, but the lower night sky beneath the auroral
 * arc remained too close to black. Full-world orthographic proof then exposed a shipped-runtime
 * composition problem: finite world-anchored marine planes can end inside the camera frustum,
 * revealing the camera-relative sky below them as a sharply different rectangular colour family.
 *
 * The previous V5 policy correctly derived a marine floor from the shared deep-sea palette, but its
 * `nightBounce` replacement target no longer exists in the V4 final shader, so that part of the fix
 * was a no-op. This revision applies the shared marine floor at the actual V4 `skyColor` composition
 * point. Only below-horizon night fragments converge to the marine palette; horizon/day/twilight and
 * auroral geometry remain authored by the existing shader. Geography, hydrology and water coverage
 * are untouched.
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
	id: 'camera-relative-marine-lower-hemisphere-continuity-v3-effective-shader-blend',
	renderOnly: true,
	cameraRelative: true,
	canonicalGeographyUnchanged: true,
	canonicalWaterCoverageUnchanged: true,
	finiteWaterFootprintSafe: true,
	blackBackgroundFallback: false,
	sharedDeepSeaPalette: true,
	explicitBelowHorizonBlend: true,
	blendFullBelowDirectionY: -0.16,
	blendReleasedDirectionY: 0.035,
	nightBlendStart: 0.45,
	nightBlendFull: 0.95,
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
			`vec3 skyColor = mix(canonicalSky, deepSky, deepBlend);\n\t\tfloat marineFloorMask = (1.0 - smoothstep(${WORLD_SKY_MARINE_FLOOR_POLICY.blendFullBelowDirectionY.toFixed(3)}, ${WORLD_SKY_MARINE_FLOOR_POLICY.blendReleasedDirectionY.toFixed(3)}, dir.y)) * smoothstep(${WORLD_SKY_MARINE_FLOOR_POLICY.nightBlendStart.toFixed(2)}, ${WORLD_SKY_MARINE_FLOOR_POLICY.nightBlendFull.toFixed(2)}, uNightFactor);\n\t\tvec3 marineNightFloor = vec3(${marineFloor});\n\t\tskyColor = mix(skyColor, marineNightFloor, marineFloorMask);`,
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
