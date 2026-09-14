import assert from 'node:assert/strict';
import {
	TERRAIN_CRYOSPHERE_POLICY,
	resolveTerrainCryosphere,
	resolveCryosphereMaterialResponse,
} from '../src/3d/world/terrainSurfaceCryosphere.js';

const near = (value, min, max, message) => {
	assert.ok(Number.isFinite(value), `${message}: expected a finite value`);
	assert.ok(value >= min && value <= max, `${message}: ${value} outside [${min}, ${max}]`);
};

assert.equal(TERRAIN_CRYOSPHERE_POLICY.renderOnly, true);
assert.equal(TERRAIN_CRYOSPHERE_POLICY.deterministic, true);
assert.equal(TERRAIN_CRYOSPHERE_POLICY.canonicalHeightUnchanged, true);
assert.equal(TERRAIN_CRYOSPHERE_POLICY.canonicalHydrologyUnchanged, true);
assert.equal(TERRAIN_CRYOSPHERE_POLICY.canonicalIceGeometryUnchanged, true);
assert.equal(TERRAIN_CRYOSPHERE_POLICY.canonicalColliderUnchanged, true);
assert.equal(TERRAIN_CRYOSPHERE_POLICY.newGeographyIntroduced, false);
assert.deepEqual(TERRAIN_CRYOSPHERE_POLICY.meltBandMeters, [140, 300, 470]);

const cases = [
	{ name: 'lowland', worldX: 1200, worldZ: -870, heightMeters: 92, slopeDegrees: 8, northness: 0.7, snowSignal: 0.02 },
	{ name: 'lower-freeze-thaw', worldX: 1200, worldZ: -870, heightMeters: 205, slopeDegrees: 9, northness: -0.2, snowSignal: 0.82 },
	{ name: 'upper-freeze-thaw', worldX: -1840, worldZ: 320, heightMeters: 510, slopeDegrees: 7, northness: -0.4, snowSignal: 0.86 },
	{ name: 'high-cold', worldX: -1840, worldZ: 320, heightMeters: 680, slopeDegrees: 12, northness: 0.8, snowSignal: 0.93 },
];

const resolved = cases.map((input) => ({ input, state: resolveTerrainCryosphere(input) }));

for (const { input, state } of resolved) {
	for (const key of ['broad', 'sastrugi', 'crust', 'grain', 'snow', 'scour', 'deposition', 'crustMask', 'granular', 'meltBand', 'meltFilm', 'refreezeCrust', 'exposedSubstrate', 'shadowCold']) {
		near(state[key], 0, 1, `${input.name}.${key}`);
	}
	if (state.meltFilm > 0) assert.ok(state.snow > 0, `${input.name}: melt film requires snow`);
	assert.ok(state.refreezeCrust <= state.meltFilm + 1e-9, `${input.name}: refreeze crust must be bounded by melt film`);
}

const deterministicA = resolveTerrainCryosphere(cases[2]);
const deterministicB = resolveTerrainCryosphere(cases[2]);
assert.deepEqual(deterministicA, deterministicB, 'same world sample must be deterministic');

assert.ok(resolved[1].state.meltBand > resolved[0].state.meltBand, 'lower freeze-thaw band must exceed lowland melt response');
assert.ok(resolved[2].state.meltBand > 0, 'upper freeze-thaw band must be active');
assert.ok(resolved[3].state.meltBand < resolved[2].state.meltBand, 'high cold zone must leave the upper melt band');

const baseColor = { r: 0.72, g: 0.77, b: 0.80 };
const response = resolveCryosphereMaterialResponse({ state: resolved[2].state, baseColor });
near(response.roughness, 0, 1, 'material roughness');
near(response.normalStrength, 0, TERRAIN_CRYOSPHERE_POLICY.normalEnergy + 1e-9, 'material normal strength');
for (const channel of ['r', 'g', 'b']) near(response.color[channel], 0, 1, `material color.${channel}`);

const baseline = resolveCryosphereMaterialResponse({
	state: { ...resolved[2].state, meltFilm: 0, refreezeCrust: 0 },
	baseColor,
});
assert.ok(response.roughness <= baseline.roughness + 1e-9, 'melt film should not increase roughness');
assert.ok(response.color.b >= baseline.color.b - 1e-9, 'melt film should preserve a cool blue film response');

console.log('[terrain-cryosphere-freeze-thaw] PASS');
console.log(JSON.stringify({
	policyId: TERRAIN_CRYOSPHERE_POLICY.id,
	meltBandMeters: TERRAIN_CRYOSPHERE_POLICY.meltBandMeters,
	lowerBand: resolved[1].state.meltBand,
	upperBand: resolved[2].state.meltBand,
	highColdBand: resolved[3].state.meltBand,
	freezeThawCases: resolved.length,
	canonicalHeightUnchanged: TERRAIN_CRYOSPHERE_POLICY.canonicalHeightUnchanged,
	canonicalHydrologyUnchanged: TERRAIN_CRYOSPHERE_POLICY.canonicalHydrologyUnchanged,
	canonicalIceGeometryUnchanged: TERRAIN_CRYOSPHERE_POLICY.canonicalIceGeometryUnchanged,
	canonicalColliderUnchanged: TERRAIN_CRYOSPHERE_POLICY.canonicalColliderUnchanged,
}, null, 2));
