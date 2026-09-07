/**
 * Runtime-facing adapter for canonical biome asset decisions.
 *
 * This module is the narrow seam between world coordinates and the policy/recipe layers added in
 * this vertical slice. A producer asks for one context and receives canonical map position, biome
 * distribution, a bounded placement plan, and semantic surface recipes. The producer still owns
 * actual GLB loading, mesh creation, scene attachment, colliders, and disposal.
 *
 * The adapter intentionally has no Three.js dependency and no DOM dependency. It can therefore be
 * used by desktop/mobile world generation, headless acceptance, and the player appearance seam without
 * forking geography logic.
 *
 * @module world/biomeAssetRuntimeAdapter
 */

import {
	resolveBiomeAssetDistribution,
	assertBiomeDistributionConsistency,
	mapAssetDistributionToWorldXZ,
} from './biomeAssetDistribution.js';
import {
	createBiomeAssetPlacementPlan,
	createRegionalArchitectureRing,
	createRegionalRockField,
	createRegionalSceneryRing,
	deterministicPlacementDigest,
	resolvePlacementSurfaceVariant,
	validatePlacementPlan,
} from './biomeAssetPlacementPlanner.js';
import { resolveBiomeSurfaceFabric, resolveAssetFamilySurfaceFabric, buildSharedMaterialSemanticManifest } from '../materials/biomeSurfaceFabric.js';
import { WORLD_REFERENCE_ALIGNMENT, worldXZToNormalizedReference, normalizedReferenceToWorldXZ } from './worldReferenceAlignment.js';

const VERSION = '2026-09-07-v1';
const DEFAULT_TEXTURE_SIZE = 256;
const MAX_CONTEXT_RADIUS_METERS = 2400;

function finite(value, fallback = 0) {
	return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, Number(value) || 0));
}

function normalizeWorldPosition(worldX, worldZ) {
	if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) throw new TypeError('world X/Z must be finite');
	return Object.freeze({ x: worldX, z: worldZ });
}

function freezeObject(value) {
	return Object.freeze({ ...value });
}

function freezeArray(values) {
	return Object.freeze(values.map((value) => Object.freeze({ ...value })));
}

function roleForFamily(family = '') {
	const text = String(family).toLowerCase();
	if (text.includes('rock') || text.includes('boulder') || text.includes('stone') || text.includes('outcrop') || text.includes('talus') || text.includes('scree') || text.includes('rubble')) return 'rock';
	if (text.includes('tree') || text.includes('wood') || text.includes('shrub') || text.includes('broadleaf') || text.includes('palm') || text.includes('reed') || text.includes('fern')) return 'wood';
	if (text.includes('metal') || text.includes('iron') || text.includes('bronze') || text.includes('copper')) return 'metal';
	return 'ground';
}

function categoryDefaultDensity(category) {
	if (category === 'geology') return 18;
	if (category === 'architecture') return 4;
	return 32;
}

function clampRadius(radiusMeters) {
	return clamp(radiusMeters, 0, MAX_CONTEXT_RADIUS_METERS);
}

export const BIOME_ASSET_RUNTIME_ADAPTER_POLICY = Object.freeze({
	id: `biome-asset-runtime-adapter-${VERSION}`,
	version: VERSION,
	deterministic: true,
	canonicalMapAuthority: 'worldReferenceMap.js',
	alignmentAuthority: 'worldReferenceAlignment.js',
	materialAuthority: 'MaterialAssignmentCore.js',
	placementAuthority: 'WorldAssetPlacementPipeline.js',
	textureSize: DEFAULT_TEXTURE_SIZE,
	maxContextRadiusMeters: MAX_CONTEXT_RADIUS_METERS,
	categories: Object.freeze(['vegetation', 'geology', 'architecture', 'winter', 'player']),
});

export function worldXZToBiomeAssetContext({ worldX, worldZ, mapBounds, metersPerMapUnit, seed = 0, category = 'vegetation', sampleHeightMeters, seaLevelMeters = 6, seats = [], roadEdges = [], radiusMeters = 260, sampleOffsetMeters = 2, baseDensityPerKm2 } = {}) {
	const position = normalizeWorldPosition(worldX, worldZ);
	if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters is required');
	const normalized = worldXZToNormalizedReference(position.x, position.z, mapBounds, metersPerMapUnit);
	const distribution = resolveBiomeAssetDistribution(normalized.x, normalized.y, seed, { sampleCount: 10 });
	assertBiomeDistributionConsistency(distribution);
	const safeRadius = clampRadius(radiusMeters);
	const plan = createBiomeAssetPlacementPlan({
		normalizedX: normalized.x,
		normalizedY: normalized.y,
		worldX: position.x,
		worldZ: position.z,
		seed,
		category,
		sampleHeightMeters,
		seaLevelMeters,
		seats,
		roadEdges,
		radiusMeters: safeRadius,
		baseDensityPerKm2: Number.isFinite(baseDensityPerKm2) ? baseDensityPerKm2 : categoryDefaultDensity(category),
		sampleOffsetMeters,
	});
	const validation = validatePlacementPlan(plan);
	if (!validation.ok) throw new Error(`invalid biome asset placement plan: ${validation.errors.join(',')}`);
	return Object.freeze({
		policyId: BIOME_ASSET_RUNTIME_ADAPTER_POLICY.id,
		version: VERSION,
		category,
		worldPosition: position,
		normalizedReference: normalized,
		distribution,
		plan,
		planDigest: deterministicPlacementDigest(plan),
	});
}

export function biomeAssetContextFromCanonicalMap({ normalizedX, normalizedY, worldX, worldZ, seed = 0, category = 'vegetation', sampleHeightMeters, seaLevelMeters = 6, seats = [], roadEdges = [], radiusMeters = 260, sampleOffsetMeters = 2, baseDensityPerKm2 } = {}) {
	if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('canonical normalized coordinates must be finite');
	if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters is required');
	const distribution = resolveBiomeAssetDistribution(normalizedX, normalizedY, seed, { sampleCount: 10 });
	assertBiomeDistributionConsistency(distribution);
	const safeRadius = clampRadius(radiusMeters);
	const plan = createBiomeAssetPlacementPlan({ normalizedX, normalizedY, worldX, worldZ, seed, category, sampleHeightMeters, seaLevelMeters, seats, roadEdges, radiusMeters: safeRadius, baseDensityPerKm2: Number.isFinite(baseDensityPerKm2) ? baseDensityPerKm2 : categoryDefaultDensity(category), sampleOffsetMeters });
	const validation = validatePlacementPlan(plan);
	if (!validation.ok) throw new Error(`invalid biome asset placement plan: ${validation.errors.join(',')}`);
	return Object.freeze({ policyId: BIOME_ASSET_RUNTIME_ADAPTER_POLICY.id, version: VERSION, category, worldPosition: normalizeWorldPosition(worldX, worldZ), normalizedReference: Object.freeze({ x: normalizedX, y: normalizedY }), distribution, plan, planDigest: deterministicPlacementDigest(plan) });
}

export function decorateBiomeAssetPlacement(context, placement, { textureSize = DEFAULT_TEXTURE_SIZE } = {}) {
	if (!context?.distribution || !placement) throw new TypeError('context and placement are required');
	const role = placement.family === 'architecture' ? 'wood' : roleForFamily(placement.family);
	const surfaceVariant = resolvePlacementSurfaceVariant(context.distribution, placement);
	const fabric = resolveAssetFamilySurfaceFabric(context.distribution.profileId, placement.family, {
		textureSize,
		slopeDegrees: placement.slopeDegrees,
		waterDistanceMeters: placement.waterDepth > 0 ? 0 : placement.roadDistance,
	});
	return Object.freeze({
		...placement,
		semanticRole: role,
		surfaceVariant,
		surfaceFabric: fabric,
	});
}

export function decorateBiomeAssetPlan(context, { textureSize = DEFAULT_TEXTURE_SIZE } = {}) {
	if (!context?.plan) throw new TypeError('biome asset context must contain a plan');
	const placements = context.plan.placements.map((placement) => decorateBiomeAssetPlacement(context, placement, { textureSize }));
	return Object.freeze({
		...context,
		placements: freezeArray(placements),
	});
}

export function buildBiomeAssetSurfaceManifest({ assetId, assetFamily, profileId, role = 'ground', textureSize = DEFAULT_TEXTURE_SIZE } = {}) {
	const normalizedRole = String(role || 'ground').toLowerCase();
	const recipe = resolveBiomeSurfaceFabric(profileId, normalizedRole, { textureSize });
	const manifest = buildSharedMaterialSemanticManifest({ assetId, assetFamily, profileId, surfaces: [normalizedRole], options: { textureSize } });
	return Object.freeze({
		policyId: BIOME_ASSET_RUNTIME_ADAPTER_POLICY.id,
		recipe,
		manifest,
	});
}

export function categoryPlanFactory(category, options) {
	if (category === 'vegetation') return createRegionalSceneryRing(options);
	if (category === 'geology') return createRegionalRockField(options);
	if (category === 'architecture') return createRegionalArchitectureRing(options);
	return createBiomeAssetPlacementPlan({ ...options, category });
}

export function createRegionalBiomeContext({ category = 'vegetation', worldX, worldZ, normalizedX, normalizedY, seed, sampleHeightMeters, seaLevelMeters, seats, roadEdges, radiusMeters, mapBounds, metersPerMapUnit, textureSize = DEFAULT_TEXTURE_SIZE } = {}) {
	const context = worldXZ !== undefined && worldZ !== undefined
		? worldXZToBiomeAssetContext({ category, worldX, worldZ, mapBounds, metersPerMapUnit, seed, sampleHeightMeters, seaLevelMeters, seats, roadEdges, radiusMeters })
		: biomeAssetContextFromCanonicalMap({ category, worldX, worldZ, normalizedX, normalizedY, seed, sampleHeightMeters, seaLevelMeters, seats, roadEdges, radiusMeters });
	return decorateBiomeAssetPlan(context, { textureSize });
}

export function getPlacementSurfaceFabric(context, placementIndex = 0, textureSize = DEFAULT_TEXTURE_SIZE) {
	const placement = context?.placements?.[placementIndex] || context?.plan?.placements?.[placementIndex];
	if (!placement) return null;
	return decorateBiomeAssetPlacement(context, placement, { textureSize }).surfaceFabric;
}

export function getPlacementSurfaceVariant(context, placementIndex = 0) {
	const placement = context?.placements?.[placementIndex] || context?.plan?.placements?.[placementIndex];
	if (!placement) return null;
	return resolvePlacementSurfaceVariant(context.distribution, placement);
}

export function regionalContextSummary(context) {
	if (!context) return null;
	const placements = context.placements || context.plan?.placements || [];
	const families = new Map();
	for (const placement of placements) families.set(placement.family, (families.get(placement.family) || 0) + 1);
	return Object.freeze({
		policyId: BIOME_ASSET_RUNTIME_ADAPTER_POLICY.id,
		category: context.category,
		profileId: context.distribution?.profileId || context.plan?.profileId || null,
		confidence: context.distribution?.confidence ?? 0,
		densityMultiplier: context.distribution?.densityMultiplier ?? 0,
		targetCount: context.plan?.targetCount ?? placements.length,
		placedCount: placements.length,
		planDigest: context.planDigest || (context.plan ? deterministicPlacementDigest(context.plan) : null),
		families: Object.freeze([...families.entries()].sort((a, b) => b[1] - a[1]).map(([family, count]) => Object.freeze({ family, count }))),
	});
}

export function assertBiomeAssetRuntimeContext(context) {
	const errors = [];
	if (!context || typeof context !== 'object') errors.push('context-missing');
	if (context && context.policyId !== BIOME_ASSET_RUNTIME_ADAPTER_POLICY.id) errors.push('policy-id-mismatch');
	if (context && !context.distribution) errors.push('distribution-missing');
	if (context && !context.plan) errors.push('plan-missing');
	if (context?.distribution) {
		try { assertBiomeDistributionConsistency(context.distribution); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
	}
	if (context?.plan) {
		const validation = validatePlacementPlan(context.plan);
		if (!validation.ok) errors.push(...validation.errors);
	}
	if (context?.normalizedReference) {
		if (context.normalizedReference.x < 0 || context.normalizedReference.x > 1) errors.push('normalized-x-out-of-range');
		if (context.normalizedReference.y < 0 || context.normalizedReference.y > 1) errors.push('normalized-y-out-of-range');
	}
	return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function roundTripCanonicalWorldPosition({ normalizedX, normalizedY, mapBounds, metersPerMapUnit } = {}) {
	const world = normalizedReferenceToWorldXZ(normalizedX, normalizedY, mapBounds, metersPerMapUnit);
	const normalized = worldXZToNormalizedReference(world.x, world.z, mapBounds, metersPerMapUnit);
	return Object.freeze({ world, normalized, error: Object.freeze({ x: Math.abs(normalized.x - normalizedX), y: Math.abs(normalized.y - normalizedY) }) });
}

export function candidateSurfaceManifests(context, { textureSize = DEFAULT_TEXTURE_SIZE } = {}) {
	const placements = context?.placements || context?.plan?.placements || [];
	const seen = new Set();
	const manifests = [];
	for (const placement of placements) {
		const key = `${placement.family}:${context.distribution.profileId}:${roleForFamily(placement.family)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		manifests.push(buildBiomeAssetSurfaceManifest({
			assetId: placement.asset || placement.family,
			assetFamily: placement.family,
			profileId: context.distribution.profileId,
			role: roleForFamily(placement.family),
			textureSize,
		}));
	}
	return Object.freeze(manifests);
}

export function createPlayerGeographicAppearanceContext({ normalizedX, normalizedY, seed, textureSize = DEFAULT_TEXTURE_SIZE } = {}) {
	const distribution = resolveBiomeAssetDistribution(normalizedX, normalizedY, seed, { sampleCount: 1 });
	return Object.freeze({
		policyId: BIOME_ASSET_RUNTIME_ADAPTER_POLICY.id,
		kind: 'player-appearance',
		normalizedReference: Object.freeze({ x: normalizedX, y: normalizedY }),
		profileId: distribution.profileId,
		confidence: distribution.confidence,
		material: Object.freeze({
			textureSize,
			fabric: resolveBiomeSurfaceFabric(distribution.profileId, 'wood', { textureSize }),
		}),
		distribution,
	});
}

export function createVegetationGeographicContext(options = {}) {
	return createRegionalBiomeContext({ ...options, category: 'vegetation' });
}

export function createGeologyGeographicContext(options = {}) {
	return createRegionalBiomeContext({ ...options, category: 'geology' });
}

export function createArchitectureGeographicContext(options = {}) {
	return createRegionalBiomeContext({ ...options, category: 'architecture' });
}

export function runtimeBiomeDigest(context) {
	const summary = regionalContextSummary(context);
	const source = JSON.stringify(summary);
	let hash = 2166136261;
	for (let index = 0; index < source.length; index += 1) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

export function listRuntimeCategories() {
	return BIOME_ASSET_RUNTIME_ADAPTER_POLICY.categories;
}

export function mapContextToWorld(context, mapBounds, metersPerMapUnit) {
	if (!context?.normalizedReference) return null;
	return normalizedReferenceToWorldXZ(context.normalizedReference.x, context.normalizedReference.y, mapBounds, metersPerMapUnit);
}

export function mapWorldToContext(worldX, worldZ, mapBounds, metersPerMapUnit, seed = 0, category = 'vegetation') {
	const normalized = worldXZToNormalizedReference(worldX, worldZ, mapBounds, metersPerMapUnit);
	return Object.freeze({ normalized, distribution: resolveBiomeAssetDistribution(normalized.x, normalized.y, seed, { sampleCount: 6 }), category });
}

export function regionalMaterialSurface(context, role = 'ground', options = {}) {
	return resolveBiomeSurfaceFabric(context?.distribution?.profileId || context?.profileId || 'temperate', role, options);
}

export function regionalFamilyMaterialSurface(context, family, options = {}) {
	return resolveAssetFamilySurfaceFabric(context?.distribution?.profileId || context?.profileId || 'temperate', family, options);
}

export function runtimeAdapterAudit(context) {
	const validation = assertBiomeAssetRuntimeContext(context);
	const placements = context?.placements || context?.plan?.placements || [];
	const missingFamilies = placements.filter((item) => !item.family).length;
	const missingScales = placements.filter((item) => !Number.isFinite(item.scale) || item.scale <= 0).length;
	return Object.freeze({
		ok: validation.ok && missingFamilies === 0 && missingScales === 0,
		errors: Object.freeze([...validation.errors, ...(missingFamilies ? ['missing-family'] : []), ...(missingScales ? ['missing-scale'] : [])]),
		placementCount: placements.length,
		profileId: context?.distribution?.profileId || null,
		planDigest: context?.planDigest || null,
	});
}

export function contextToSerializable(context) {
	if (!context) return null;
	const placements = context.placements || context.plan?.placements || [];
	return Object.freeze({
		policyId: context.policyId,
		version: context.version,
		category: context.category,
		worldPosition: context.worldPosition,
		normalizedReference: context.normalizedReference,
		profileId: context.distribution?.profileId || null,
		confidence: context.distribution?.confidence || 0,
		planDigest: context.planDigest || null,
		placements: freezeArray(placements),
	});
}
