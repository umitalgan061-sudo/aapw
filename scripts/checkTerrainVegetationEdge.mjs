#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	TERRAIN_VEGETATION_EDGE_POLICY,
	resolveTerrainVegetationEdge,
	resolveVegetationMaterialResponse,
} from '../src/3d/world/terrainSurfaceVegetationEdge.js';
import { TERRAIN_LOWINLAND_FABRIC_POLICY } from '../src/3d/world/terrainSurfaceLowlandFabric.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const clamp01 = (value) => value >= 0 && value <= 1 && Number.isFinite(value);
function deterministic(label, factory) {
	const a = factory();
	const b = factory();
	assert.deepEqual(a, b, `${label} must be deterministic`);
	return a;
}
function boundedState(label, state, keys) {
	for (const key of keys) assert(clamp01(state[key]), `${label}.${key} must be bounded`);
}

async function main() {
	assert.equal(TERRAIN_VEGETATION_EDGE_POLICY.renderOnly, true);
	assert.equal(TERRAIN_VEGETATION_EDGE_POLICY.deterministic, true);
	assert.equal(TERRAIN_VEGETATION_EDGE_POLICY.canonicalHeightUnchanged, true);
	assert.equal(TERRAIN_VEGETATION_EDGE_POLICY.canonicalHydrologyUnchanged, true);
	assert.equal(TERRAIN_VEGETATION_EDGE_POLICY.canonicalBiomeUnchanged, true);
	assert.equal(TERRAIN_VEGETATION_EDGE_POLICY.canonicalVegetationPlacementUnchanged, true);
	assert.equal(TERRAIN_VEGETATION_EDGE_POLICY.canonicalColliderUnchanged, true);
	assert.equal(TERRAIN_VEGETATION_EDGE_POLICY.newGeographyIntroduced, false);
	assert.equal(TERRAIN_LOWINLAND_FABRIC_POLICY.vegetationEdgePolicyId, TERRAIN_VEGETATION_EDGE_POLICY.id);

	const lowWet = deterministic('low wet vegetation field', () => resolveTerrainVegetationEdge({
		worldX: 1200,
		worldZ: -700,
		heightMeters: 48,
		slopeDegrees: 5,
		moisture: 0.84,
		vegetationSignal: 0.91,
		canopyDensity: 0.72,
	}));
	const highDry = deterministic('high dry vegetation field', () => resolveTerrainVegetationEdge({
		worldX: 1200,
		worldZ: -700,
		heightMeters: 280,
		slopeDegrees: 38,
		moisture: 0.22,
		vegetationSignal: 0.62,
		canopyDensity: 0.20,
	}));

	boundedState('lowWet', lowWet, ['wetness', 'drought', 'grass', 'wetMeadow', 'dryGrass', 'heath', 'forestFloor', 'bare', 'stress']);
	boundedState('highDry', highDry, ['wetness', 'drought', 'grass', 'wetMeadow', 'dryGrass', 'heath', 'forestFloor', 'bare', 'stress']);
	assert(lowWet.wetMeadow > highDry.wetMeadow, 'wet lowland must favour meadow continuity');
	assert(lowWet.stress < highDry.stress, 'steep/dry ground must have stronger vegetation stress');
	assert(highDry.bare >= 0, 'bare patch response must stay valid');

	const response = resolveVegetationMaterialResponse({ state: lowWet, baseColor: { r: 0.20, g: 0.34, b: 0.14 } });
	assert(clamp01(response.roughness), 'vegetation roughness must be bounded');
	assert(clamp01(response.normalStrength), 'vegetation normal response must be bounded');

	const microSurface = await fs.readFile(path.join(repoRoot, 'src/3d/world/terrainMicroSurface.js'), 'utf8');
	const lowlandFabric = await fs.readFile(path.join(repoRoot, 'src/3d/world/terrainSurfaceLowlandFabric.js'), 'utf8');
	assert(microSurface.includes('installTerrainLowlandFabric(material)'), 'terrainMicroSurface must invoke lowland fabric');
	assert(lowlandFabric.includes("from './terrainSurfaceVegetationEdge.js'"), 'lowland fabric must import vegetation edge');
	assert(lowlandFabric.includes('installTerrainVegetationEdge(material)'), 'lowland fabric must chain vegetation edge');
	console.log('[checkTerrainVegetationEdge] PASS', JSON.stringify({
		policyId: TERRAIN_VEGETATION_EDGE_POLICY.id,
		lowlandPolicyId: TERRAIN_LOWINLAND_FABRIC_POLICY.id,
		canonicalHeightUnchanged: true,
		canonicalHydrologyUnchanged: true,
		canonicalBiomeUnchanged: true,
		canonicalVegetationPlacementUnchanged: true,
		canonicalColliderUnchanged: true,
		newGeographyIntroduced: false,
	}));
}

main().catch((error) => {
	console.error('[checkTerrainVegetationEdge] FAIL', error);
	process.exitCode = 1;
});
