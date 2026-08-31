#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	GEOGRAPHIC_REFERENCE_PALETTE,
	GEOGRAPHIC_REFERENCE_PALETTE_POLICY,
	relativeLuminanceFromHex,
} from '../src/3d/world/geographicReferencePalette.js';

const { terrain, road, water, celestial } = GEOGRAPHIC_REFERENCE_PALETTE;
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
assert.equal(water.abyss, water.deepSea, 'abyss underlay must share deep-sea chroma so transparent marine water cannot expose a rectangular colour-family seam');
assert.equal(relativeLuminanceFromHex(water.abyss), relativeLuminanceFromHex(water.deepSea));
assert(relativeLuminanceFromHex(water.foam) > relativeLuminanceFromHex(water.plunge));
assert.notEqual(celestial.dawn, celestial.moon);

console.log(`[checkGeographicReferencePalette] PASS: ${GEOGRAPHIC_REFERENCE_PALETTE_POLICY.id}; terrain/road/shore-depth/abyss-continuity/foam/celestial luminance contract is coherent.`);
