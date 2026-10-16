/**
 * Runtime adapter for the terrain anti-tiling response.
 *
 * This module keeps camera-relative fade separate from world-space sampling so full-world and
 * terrain-near views receive the same deterministic surface response without making the origin
 * accidentally control detail visibility. It is intentionally render-only and delegates all
 * canonical context to the existing terrain/material authorities.
 */
import {
	TERRAIN_SURFACE_ANTI_TILING_POLICY,
	buildTerrainSurfaceMaterialInputs,
	terrainSurfaceAntiTilingAt,
	validateTerrainSurfaceAntiTilingResponse,
} from './terrainSurfaceAntiTiling.js';

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value)));

export const TERRAIN_SURFACE_RUNTIME_POLICY = Object.freeze({
	id: 'terrain-surface-anti-tiling-runtime-2026-09-07-v1',
	basePolicyId: TERRAIN_SURFACE_ANTI_TILING_POLICY.id,
	cameraRelativeFade: true,
	canonicalAuthorityPreserved: true,
	shaderMutationRequired: false,
});

export function terrainSurfaceRuntimeInputs(worldX, worldZ, context = {}) {
	const cameraX = finite(context.cameraX, 0);
	const cameraZ = finite(context.cameraZ, 0);
	const cameraDistance = Math.hypot(finite(worldX) - cameraX, finite(worldZ) - cameraZ);
	const base = terrainSurfaceAntiTilingAt(worldX, worldZ, context);
	const fadeStart = TERRAIN_SURFACE_ANTI_TILING_POLICY.farFadeStartMeters;
	const fadeFull = TERRAIN_SURFACE_ANTI_TILING_POLICY.farFadeFullMeters;
	const t = fadeFull > fadeStart ? clamp01((cameraDistance - fadeStart) / (fadeFull - fadeStart)) : 1;
	const cameraFade = 1 - t * t * (3 - 2 * t);
	const inputs = buildTerrainSurfaceMaterialInputs(worldX, worldZ, context);
	return Object.freeze({
		...inputs,
		antiTile: base.antiTile,
		cameraDistanceMeters: cameraDistance,
		cameraFade,
		colorGain: inputs.colorGain * cameraFade,
		roughnessGain: inputs.roughnessGain * cameraFade,
		normalGain: inputs.normalGain * cameraFade,
		policyId: TERRAIN_SURFACE_RUNTIME_POLICY.id,
		canonicalContextPreserved: true,
	});
}

export function validateTerrainSurfaceRuntimeInputs(inputs) {
	const response = validateTerrainSurfaceAntiTilingResponse({
		...inputs,
		farFade: inputs?.cameraFade,
		colorGain: inputs?.colorGain,
		roughnessVariation: inputs?.roughnessGain,
		normalVariation: inputs?.normalGain,
	});
	return Object.freeze({
		ok: response.ok && inputs?.canonicalContextPreserved === true,
		errors: response.errors,
	});
}

export const TERRAIN_SURFACE_RUNTIME_MANIFEST = Object.freeze({
	policyId: TERRAIN_SURFACE_RUNTIME_POLICY.id,
	delegatesTo: TERRAIN_SURFACE_ANTI_TILING_POLICY.id,
	inputs: Object.freeze(['worldX', 'worldZ', 'cameraX', 'cameraZ', 'terrainContext']),
	outputs: Object.freeze(['colorGain', 'roughnessGain', 'normalGain', 'cameraDistanceMeters', 'cameraFade']),
	forbidden: Object.freeze(['heightMutation', 'hydrologyMutation', 'colliderMutation', 'origin-relative-fade']),
});
