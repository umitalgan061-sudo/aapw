#!/usr/bin/env node
/**
 * P0 full-world marine/background continuity contract.
 *
 * The shipped sky is assembled by applying Aurora Ray Curtain V4 and then the V5 refinement.
 * This check exists because earlier V5 revisions either targeted a stale shader token or gated the
 * lower-hemisphere continuity correction by night factor, allowing daylight full-world captures to
 * expose finite marine-plane rectangles. Keep this test focused on effective shader adoption rather
 * than image heuristics; actual createScene screenshots remain the visual acceptance authority.
 */

import { applyAuroraRayCurtainV4 } from '../src/3d/auroraRayCurtainV4.js';
import {
	applyAuroraNightAtmosphereV5,
	WORLD_SKY_MARINE_FLOOR_POLICY,
} from '../src/3d/auroraNightAtmosphereV5.js';
import { GEOGRAPHIC_REFERENCE_PALETTE } from '../src/3d/world/geographicReferencePalette.js';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function rgbTriplet(hex) {
	return [
		((hex >> 16) & 0xff) / 255,
		((hex >> 8) & 0xff) / 255,
		(hex & 0xff) / 255,
	];
}

const material = {
	fragmentShader: '',
	needsUpdate: false,
	userData: {},
};

applyAuroraRayCurtainV4(material);
const v4Shader = material.fragmentShader;
assert(v4Shader.includes('vec3 skyColor = mix(canonicalSky, deepSky, deepBlend);'),
	'V4 sky composition target drifted; V5 marine-floor adoption must be requalified');
assert(!v4Shader.includes('nightBounce'),
	'V4 unexpectedly contains legacy nightBounce; remove stale assumptions from V5 contract');

applyAuroraNightAtmosphereV5(material);
const finalShader = material.fragmentShader;
const expectedRgb = rgbTriplet(GEOGRAPHIC_REFERENCE_PALETTE.water.deepSea)
	.map((value) => value.toFixed(4))
	.join(', ');

assert(WORLD_SKY_MARINE_FLOOR_POLICY.explicitBelowHorizonBlend === true,
	'marine-floor policy no longer requires effective below-horizon shader blending');
assert(WORLD_SKY_MARINE_FLOOR_POLICY.sharedDeepSeaPalette === true,
	'marine-floor policy drifted away from shared deep-sea palette authority');
assert(WORLD_SKY_MARINE_FLOOR_POLICY.allLightingContinuity === true,
	'finite marine-footprint continuity must remain active outside night-only rendering');
assert(WORLD_SKY_MARINE_FLOOR_POLICY.blackBackgroundFallback === false,
	'black lower-sky fallback returned');
assert(WORLD_SKY_MARINE_FLOOR_POLICY.lowerHemisphereGradient === true,
	'lower marine sky returned to a flat single-colour fill');
assert(WORLD_SKY_MARINE_FLOOR_POLICY.gradientLift > 0 && WORLD_SKY_MARINE_FLOOR_POLICY.gradientLift <= 0.16,
	'lower marine gradient must remain subtle enough to avoid a new bright horizon band');
assert(finalShader.includes('float marineFloorMask = 1.0 - smoothstep('),
	'V5 did not inject the all-lighting below-horizon marine floor into the shipped V4 shader');
assert(!finalShader.includes('marineFloorMask = (1.0 - smoothstep('),
	'marine floor returned to the former gated mask expression');
assert(!finalShader.match(/marineFloorMask[^;]*uNightFactor/),
	'marine-floor continuity must not disappear during daylight/twilight captures');
assert(finalShader.includes(`vec3 marineNightFloor = vec3(${expectedRgb});`),
	'shipped marine floor is not derived from the shared deep-sea palette');
assert(finalShader.includes('float marineGradient = smoothstep('),
	'lower marine sky is missing the direction-driven anti-flat gradient');
assert(finalShader.includes('vec3 marineHorizonFloor = mix(marineNightFloor, deepHorizon,'),
	'lower marine gradient is not bounded to the existing atmospheric horizon family');
assert(finalShader.includes('vec3 marineFloorColor = mix(marineNightFloor, marineHorizonFloor, marineGradient);'),
	'lower marine gradient is declared but not composed into a bounded floor colour');
assert(finalShader.includes('skyColor = mix(skyColor, marineFloorColor, marineFloorMask);'),
	'gradient marine floor is declared but not applied to final sky colour');
assert(!finalShader.includes('skyColor = mix(skyColor, marineNightFloor, marineFloorMask);'),
	'flat lower-hemisphere fill returned and can recreate a single-colour background field');
assert(finalShader.indexOf('marineFloorMask') < finalShader.indexOf('vec3 finalColor = skyColor;'),
	'marine-floor blend must happen before final sky colour composition');
assert(material.needsUpdate === true && material.userData.auroraNightAtmosphereV5 === true,
	'V5 material adoption metadata drifted');
assert(material.userData.worldSkyMarineFloorPolicy === WORLD_SKY_MARINE_FLOOR_POLICY,
	'material lost the effective marine-floor policy manifest');

console.log(JSON.stringify({
	status: 'PASS',
	policy: WORLD_SKY_MARINE_FLOOR_POLICY.id,
	sharedDeepSeaHex: `0x${GEOGRAPHIC_REFERENCE_PALETTE.water.deepSea.toString(16).padStart(6, '0')}`,
	marineFloorRgb: expectedRgb,
	allLightingContinuity: true,
	lowerHemisphereGradient: true,
	gradientLift: WORLD_SKY_MARINE_FLOOR_POLICY.gradientLift,
	effectiveShaderBlend: true,
}, null, 2));
