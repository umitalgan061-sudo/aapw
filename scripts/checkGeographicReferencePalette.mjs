#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	GEOGRAPHIC_REFERENCE_PALETTE,
	GEOGRAPHIC_REFERENCE_PALETTE_POLICY,
	relativeLuminanceFromHex,
} from '../src/3d/world/geographicReferencePalette.js';

const { terrain, road, water, celestial } = GEOGRAPHIC_REFERENCE_PALETTE;
const rgbDistance = (a, b) => {
	const channel = (hex, shift) => (hex >> shift) & 0xff;
	return Math.hypot(...[16, 8, 0].map((shift) => channel(a, shift) - channel(b, shift)));
};
assert.equal(GEOGRAPHIC_REFERENCE_PALETTE_POLICY.renderOnly, true);
assert.equal(GEOGRAPHIC_REFERENCE_PALETTE_POLICY.heightAuthorityUnchanged, true);
assert.equal(GEOGRAPHIC_REFERENCE_PALETTE_POLICY.hydrologyAuthorityUnchanged, true);
assert.equal(GEOGRAPHIC_REFERENCE_PALETTE_POLICY.routeAuthorityUnchanged, true);
assert(GEOGRAPHIC_REFERENCE_PALETTE_POLICY.assetReferences.some((path) => path.includes('dirt_road')));
assert(GEOGRAPHIC_REFERENCE_PALETTE_POLICY.assetReferences.some((path) => path.includes('rugged_mountain')));

assert(relativeLuminanceFromHex(terrain.graniteSunlit) > relativeLuminanceFromHex(terrain.graniteShadow));
assert(relativeLuminanceFromHex(terrain.graniteShadow) > relativeLuminanceFromHex(terrain.basaltWet));
assert(relativeLuminanceFromHex(road.dust) > relativeLuminanceFromHex(road.compacted));
assert(relativeLuminanceFromHex(road.compacted) > relativeLuminanceFromHex(road.rut));
assert(relativeLuminanceFromHex(water.shoreClear) > relativeLuminanceFromHex(water.deepSea));
assert(relativeLuminanceFromHex(water.deepSea) > relativeLuminanceFromHex(water.abyss));
assert(relativeLuminanceFromHex(water.foam) > relativeLuminanceFromHex(water.plunge));
assert.notEqual(celestial.dawn, celestial.moon);

// Full-world readability: broad biome families must remain visibly distinct after tone mapping.
assert(relativeLuminanceFromHex(terrain.meadow) >= relativeLuminanceFromHex(terrain.mossShadow) * 3.5,
	'meadow collapsed back into moss-shadow value');
assert(relativeLuminanceFromHex(terrain.graniteSunlit) >= relativeLuminanceFromHex(terrain.graniteShadow) * 3.0,
	'sunlit ridge/cliff contrast became too flat');
assert(rgbDistance(terrain.meadow, terrain.dryHeather) >= 45,
	'meadow and dry-heath chroma families became indistinguishable');
assert(rgbDistance(terrain.wetEarth, terrain.exposedEarth) >= 70,
	'wet and exposed soil families became indistinguishable');

console.log(`[checkGeographicReferencePalette] PASS: ${GEOGRAPHIC_REFERENCE_PALETTE_POLICY.id}; terrain/road/depth/foam/celestial luminance ordering and full-world biome separation are coherent.`);
