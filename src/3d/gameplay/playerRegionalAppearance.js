/**
 * Deterministic player appearance adapter driven by the canonical owner-map geography.
 *
 * This module is deliberately an adapter, not a second material system and not a terrain system.
 * It resolves the player's normalized map location to the strongest canonical biome signal, then
 * builds a material recipe that is applied by the shared DOM-free MaterialAssignmentCore.
 *
 * The shipped player (`peasant_girl.fbx`) is a real single-mesh/single-material Mixamo asset. Because
 * that asset carries no named surface parts, the adapter intentionally selects the shared layered
 * fallback: boot -> trousers -> belt -> tunic -> skin -> hair. Named-part figures instead receive
 * per-slot overrides while preserving imported skin/hair/eye materials unless the caller explicitly
 * chooses otherwise.
 *
 * Geography is render-semantic only. No terrain height, hydrology, route, collider or settlement data
 * is changed here. The world owner remains authoritative for those systems.
 *
 * @module gameplay/playerRegionalAppearance
 */

import {
	REFERENCE_BIOME_ZONES,
	REFERENCE_RELIEF_CHAINS,
	REFERENCE_WATER_ZONES,
	sampleReferenceInfluence,
} from '../world/worldReferenceMap.js';
import {
	analyzeMaterialSurfaces,
	applyMaterialRecipe,
	createMaterialManifest,
	validateMaterialAssignment,
} from '../materials/MaterialAssignmentCore.js';
import { findPalette } from '../materials/palettes.js';

const MIN_NORMALIZED = 0;
const MAX_NORMALIZED = 1;
const DEFAULT_TEXTURE_SIZE = 256;
const APPEARANCE_VERSION = '2026-09-07-v1';
const WORLD_REFERENCE_MAP_ID = 'owner-world-map-2026-08-08';
const WORLD_REFERENCE_MAP_SHA256 = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';

/**
 * Region visual language. These are clothing/surface choices, not biome geometry.
 * A profile intentionally stays modest: regional cloth changes the player's read without turning the
 * player into a monochrome faction marker. Skin, hair and eyes remain independently authored surfaces.
 */
export const PLAYER_REGIONAL_APPEARANCE_POLICY = Object.freeze({
	id: `player-regional-appearance-${APPEARANCE_VERSION}`,
	sourceMapId: WORLD_REFERENCE_MAP_ID,
	sourceMapSha256: WORLD_REFERENCE_MAP_SHA256,
	deterministic: true,
	mode: 'render-semantic-only',
	textureSize: DEFAULT_TEXTURE_SIZE,
	coastalInfluenceGain: 0.18,
	reliefInfluenceGain: 0.08,
	minimumConfidence: 0.18,
	profiles: Object.freeze({
		snow: Object.freeze({ tunic: 'tunic-blue', trousers: 'trousers-grey', boot: 'boot', belt: 'belt', cloak: 'cloak', skin: 'skin-olive', hair: 'hair-black', eye: 'eye-blue' }),
		coldGrassland: Object.freeze({ tunic: 'tunic-blue', trousers: 'trousers-grey', boot: 'boot', belt: 'belt', cloak: 'cloak', skin: 'skin-olive', hair: 'hair-black', eye: 'eye-blue' }),
		marsh: Object.freeze({ tunic: 'tunic-green', trousers: 'trousers-brown', boot: 'boot', belt: 'belt', cloak: 'cloak', skin: 'skin-olive', hair: 'hair-black', eye: 'eye-green' }),
		mountain: Object.freeze({ tunic: 'tunic-blue', trousers: 'trousers-grey', boot: 'boot', belt: 'belt', cloak: 'cloak', skin: 'skin-olive', hair: 'hair-black', eye: 'eye-brown' }),
		rockyHills: Object.freeze({ tunic: 'tunic-red', trousers: 'trousers-brown', boot: 'boot', belt: 'belt', cloak: 'cloak', skin: 'skin-olive', hair: 'hair-black', eye: 'eye-brown' }),
		lush: Object.freeze({ tunic: 'tunic-green', trousers: 'trousers-brown', boot: 'boot', belt: 'belt', cloak: 'cloak', skin: 'skin-olive', hair: 'hair-blonde', eye: 'eye-green' }),
		desert: Object.freeze({ tunic: 'tunic-cream', trousers: 'trousers-brown', boot: 'boot', belt: 'belt', cloak: 'cloak', skin: 'skin-olive', hair: 'hair-black', eye: 'eye-amber' }),
		steppe: Object.freeze({ tunic: 'tunic-cream', trousers: 'trousers-grey', boot: 'boot', belt: 'belt', cloak: 'cloak', skin: 'skin-olive', hair: 'hair-black', eye: 'eye-amber' }),
		arid: Object.freeze({ tunic: 'tunic-cream', trousers: 'trousers-brown', boot: 'boot', belt: 'belt', cloak: 'cloak', skin: 'skin-olive', hair: 'hair-black', eye: 'eye-amber' }),
		jungle: Object.freeze({ tunic: 'tunic-green', trousers: 'trousers-brown', boot: 'boot', belt: 'belt', cloak: 'cloak', skin: 'skin-brown', hair: 'hair-black', eye: 'eye-brown' }),
		coast: Object.freeze({ tunic: 'tunic-blue', trousers: 'trousers-brown', boot: 'boot', belt: 'belt', cloak: 'cloak', skin: 'skin-olive', hair: 'hair-blonde', eye: 'eye-blue' }),
		default: Object.freeze({ tunic: 'tunic-green', trousers: 'trousers-brown', boot: 'boot', belt: 'belt', cloak: 'cloak', skin: 'skin-olive', hair: 'hair-black', eye: 'eye-brown' }),
	}),
});

const KIND_TO_PROFILE = Object.freeze({ snow: 'snow', 'cold-grassland': 'coldGrassland', marsh: 'marsh', mountain: 'mountain', 'rocky-hills': 'rockyHills', 'lush-grassland': 'lush', desert: 'desert', steppe: 'steppe', arid: 'arid', jungle: 'jungle', 'temperate-coast': 'coast' });
const SURFACE_SLOTS = Object.freeze(['skin', 'hair', 'eye', 'tunic', 'trousers', 'boot', 'belt', 'cloak']);
const LAYER_ORDER = Object.freeze([{ slot: 'boot', to: 0.09 }, { slot: 'trousers', to: 0.46 }, { slot: 'belt', to: 0.50 }, { slot: 'tunic', to: 0.82 }, { slot: 'skin', to: 0.90 }, { slot: 'hair', to: 1.00 }]);

function clamp01(value) { return Math.max(MIN_NORMALIZED, Math.min(MAX_NORMALIZED, Number(value) || 0)); }
function normalizePoint(normalizedX, normalizedY) {
	const x = Number(normalizedX), y = Number(normalizedY);
	if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('player regional appearance coordinates must be finite');
	if (x < MIN_NORMALIZED || x > MAX_NORMALIZED || y < MIN_NORMALIZED || y > MAX_NORMALIZED) throw new RangeError('player regional appearance coordinates must be in [0,1]');
	return Object.freeze({ x, y });
}
function zoneSignal(normalizedX, normalizedY, zone) { return sampleReferenceInfluence(normalizedX, normalizedY, zone); }
function distancePointToSegmentSquared(x, y, ax, ay, bx, by) {
	const abx = bx - ax, aby = by - ay, lengthSquared = abx * abx + aby * aby;
	if (lengthSquared === 0) return (x - ax) ** 2 + (y - ay) ** 2;
	const t = clamp01(((x - ax) * abx + (y - ay) * aby) / lengthSquared), px = ax + abx * t, py = ay + aby * t;
	return (x - px) ** 2 + (y - py) ** 2;
}
function reliefSignal(normalizedX, normalizedY, gain) {
	let strongest = 0, strongestId = null;
	for (const chain of REFERENCE_RELIEF_CHAINS) {
		const points = chain.points;
		for (let index = 1; index < points.length; index += 1) {
			const [ax, ay] = points[index - 1], [bx, by] = points[index], distance = Math.sqrt(distancePointToSegmentSquared(normalizedX, normalizedY, ax, ay, bx, by));
			const signal = Math.max(0, 1 - distance / 0.11) * gain;
			if (signal > strongest) { strongest = signal; strongestId = chain.id; }
		}
	}
	return Object.freeze({ signal: strongest, chainId: strongestId });
}
function waterSignal(normalizedX, normalizedY, gain) {
	let strongest = 0, strongestId = null;
	for (const zone of REFERENCE_WATER_ZONES) {
		const signal = zoneSignal(normalizedX, normalizedY, zone) * gain;
		if (signal > strongest) { strongest = signal; strongestId = zone.id; }
	}
	return Object.freeze({ signal: strongest, zoneId: strongestId });
}
function rankedBiomeSignals(normalizedX, normalizedY) {
	return REFERENCE_BIOME_ZONES.map((zone) => ({ zone, influence: zoneSignal(normalizedX, normalizedY, zone), profileKey: KIND_TO_PROFILE[zone.kind] || 'default' }))
		.filter((entry) => entry.influence > 0)
		.sort((left, right) => right.influence - left.influence || left.zone.id.localeCompare(right.zone.id));
}
function assertKnownPaletteIds(profile) {
	const missing = [];
	for (const slot of SURFACE_SLOTS) {
		const paletteId = profile[slot];
		if (!paletteId || !findPalette(paletteId)) missing.push(`${slot}:${paletteId || 'missing'}`);
	}
	if (missing.length) throw new Error(`player regional appearance missing palette(s): ${missing.join(',')}`);
}
function deriveSeed(seed) {
	const numeric = Number(seed);
	if (Number.isFinite(numeric)) return Math.trunc(numeric) >>> 0;
	const text = String(seed ?? 'player');
	let hash = 2166136261;
	for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
	return hash >>> 0;
}
function rotateVariant(value, seed, modulus) { return Array.isArray(value) && value.length ? value[Math.abs(seed) % Math.min(modulus, value.length)] : value; }

export function resolvePlayerRegionalAppearance(normalizedX, normalizedY, seed = 0) {
	const point = normalizePoint(normalizedX, normalizedY), candidates = rankedBiomeSignals(point.x, point.y), water = waterSignal(point.x, point.y, PLAYER_REGIONAL_APPEARANCE_POLICY.coastalInfluenceGain), relief = reliefSignal(point.x, point.y, PLAYER_REGIONAL_APPEARANCE_POLICY.reliefInfluenceGain);
	const winner = candidates[0] || null, runnerUp = candidates[1] || null, winnerInfluence = winner?.influence || 0, runnerUpInfluence = runnerUp?.influence || 0;
	const confidence = clamp01(winnerInfluence + Math.max(0, winnerInfluence - runnerUpInfluence) * 0.35);
	let profileKey = winner?.profileKey || 'default';
	if (!winner && water.signal > 0.1) profileKey = 'coast';
	if (water.signal > winnerInfluence * 0.9 && winner?.zone.kind === 'temperate-coast') profileKey = 'coast';
	if (relief.signal > 0.32 && winner?.zone.kind === 'cold-grassland') profileKey = 'mountain';
	const baseProfile = PLAYER_REGIONAL_APPEARANCE_POLICY.profiles[profileKey] || PLAYER_REGIONAL_APPEARANCE_POLICY.profiles.default;
	assertKnownPaletteIds(baseProfile);
	const variantSeed = deriveSeed(seed);
	const profile = {
		...baseProfile,
		skin: rotateVariant(['skin-fair', 'skin-olive', 'skin-brown', 'skin-deep'], variantSeed + 17, 4),
		hair: rotateVariant(['hair-black', 'hair-blonde', 'hair-red'], variantSeed + 31, 3),
		eye: rotateVariant([baseProfile.eye, 'eye-brown', 'eye-blue', 'eye-green', 'eye-amber'], variantSeed + 53, 5),
	};
	assertKnownPaletteIds(profile);
	return Object.freeze({
		version: APPEARANCE_VERSION, point, zoneId: winner?.zone.id || null, biomeKind: winner?.zone.kind || null, profileKey,
		confidence: Number(confidence.toFixed(4)), winnerInfluence: Number(winnerInfluence.toFixed(4)), runnerUpInfluence: Number(runnerUpInfluence.toFixed(4)),
		waterSignal: Number(water.signal.toFixed(4)), waterZoneId: water.zoneId, reliefSignal: Number(relief.signal.toFixed(4)), reliefChainId: relief.chainId,
		profile: Object.freeze({ ...profile }), map: Object.freeze({ id: WORLD_REFERENCE_MAP_ID, sha256: WORLD_REFERENCE_MAP_SHA256 }),
	});
}

function namedSurfaceRecipe(profile, analysis, textureSize) {
	const surfaceOverrides = {};
	for (const surface of analysis.surfaces) if (surface.slot && profile[surface.slot]) surfaceOverrides[surface.key] = profile[surface.slot];
	if (!Object.keys(surfaceOverrides).length) return null;
	return { version: 1, mode: 'surface', surfaceOverrides, textureSize };
}
function layeredFallbackRecipe(profile, textureSize, targetMeshIndex = 0) {
	return { version: 1, mode: 'layers', targetMeshIndex, textureSize, layers: LAYER_ORDER.map(({ slot, to }) => ({ to, palette: profile[slot] })) };
}
export function buildPlayerRegionalMaterialRecipe(object, regionalContext, { textureSize = DEFAULT_TEXTURE_SIZE } = {}) {
	if (!object) throw new TypeError('player regional appearance object is required');
	if (!regionalContext?.profile) throw new TypeError('player regional appearance context is required');
	assertKnownPaletteIds(regionalContext.profile);
	const analysis = analyzeMaterialSurfaces(object), named = namedSurfaceRecipe(regionalContext.profile, analysis, textureSize);
	if (named && analysis.namedSurfaceCount > 0) return named;
	return layeredFallbackRecipe(regionalContext.profile, textureSize, 0);
}
export function applyPlayerRegionalAppearance(object, { normalizedX, normalizedY, seed = 0, textureSize = DEFAULT_TEXTURE_SIZE, allowLowConfidence = false } = {}) {
	const regionalContext = resolvePlayerRegionalAppearance(normalizedX, normalizedY, seed);
	if (!allowLowConfidence && regionalContext.confidence < PLAYER_REGIONAL_APPEARANCE_POLICY.minimumConfidence) return Object.freeze({ ok: false, error: 'low-regional-confidence', context: regionalContext });
	const recipe = buildPlayerRegionalMaterialRecipe(object, regionalContext, { textureSize });
	const materialResult = applyMaterialRecipe(object, recipe, { metadata: { id: object.userData?.assetId || 'player', name: object.name || 'player', category: 'player' } });
	if (!materialResult.ok) return Object.freeze({ ok: false, error: `material:${materialResult.error}`, context: regionalContext, recipe });
	object.updateMatrixWorld?.(true);
	const validation = validateMaterialAssignment(object, { requireGeneratedTexture: true });
	if (!validation.ok) return Object.freeze({ ok: false, error: validation.errors.join(','), context: regionalContext, recipe, validation });
	const manifest = createMaterialManifest(object, { metadata: { id: object.userData?.assetId || 'player', name: object.name || 'player', category: 'player', src: object.userData?.assetSrc || '' }, placement: { coordinateSpace: 'canonical-normalized-map', normalizedX: regionalContext.point.x, normalizedY: regionalContext.point.y, zoneId: regionalContext.zoneId, biomeKind: regionalContext.biomeKind, profileKey: regionalContext.profileKey, confidence: regionalContext.confidence } });
	const appearance = Object.freeze({ policyId: PLAYER_REGIONAL_APPEARANCE_POLICY.id, mapId: WORLD_REFERENCE_MAP_ID, mapSha256: WORLD_REFERENCE_MAP_SHA256, context: regionalContext, recipe, meshCount: validation.meshCount, surfaceCount: validation.surfaceCount, generatedMaterialCount: validation.generatedMaterialCount, materialSlotCount: validation.materialSlotCount, missingMaterialCount: 0, manifest });
	object.userData.playerRegionalAppearance = appearance;
	object.userData.playerRegionalAppearanceReady = true;
	object.userData.playerRegionalAppearanceManifest = manifest;
	return Object.freeze({ ok: true, object, context: regionalContext, recipe, validation, manifest, appearance });
}
export function auditPlayerRegionalAppearance(object) {
	const appearance = object?.userData?.playerRegionalAppearance, errors = [];
	if (!appearance) errors.push('regional-appearance-missing');
	if (appearance?.mapId !== WORLD_REFERENCE_MAP_ID) errors.push('map-id-mismatch');
	if (appearance?.mapSha256 !== WORLD_REFERENCE_MAP_SHA256) errors.push('map-sha-mismatch');
	if (!object?.userData?.playerRegionalAppearanceReady) errors.push('regional-appearance-gate-not-used');
	let validation = null;
	if (object) { validation = validateMaterialAssignment(object, { requireGeneratedTexture: true }); errors.push(...validation.errors.map((error) => `material:${error}`)); }
	const profile = appearance?.context?.profile;
	if (profile) { try { assertKnownPaletteIds(profile); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); } }
	return Object.freeze({ ok: errors.length === 0, errors, warnings: validation?.warnings || [], appearance: appearance || null, validation });
}
export function worldXZToCanonicalMap({ worldX, worldZ, mapBounds, metersPerMapUnit } = {}) {
	if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) throw new TypeError('world X/Z must be finite');
	if (!mapBounds || !Number.isFinite(mapBounds.minX) || !Number.isFinite(mapBounds.maxX) || !Number.isFinite(mapBounds.minY) || !Number.isFinite(mapBounds.maxY)) throw new TypeError('map bounds are required');
	if (!Number.isFinite(metersPerMapUnit) || metersPerMapUnit <= 0) throw new RangeError('metersPerMapUnit must be positive');
	const centerMapX = (mapBounds.minX + mapBounds.maxX) * 0.5, centerMapY = (mapBounds.minY + mapBounds.maxY) * 0.5;
	const mapX = worldX / metersPerMapUnit + centerMapX, mapY = worldZ / metersPerMapUnit + centerMapY;
	return Object.freeze({ x: clamp01((mapX - mapBounds.minX) / (mapBounds.maxX - mapBounds.minX)), y: clamp01((mapY - mapBounds.minY) / (mapBounds.maxY - mapBounds.minY)) });
}
export function playerRegionalAppearanceProof(object) {
	const audit = auditPlayerRegionalAppearance(object), appearance = audit.appearance;
	return Object.freeze({ ok: audit.ok, policyId: PLAYER_REGIONAL_APPEARANCE_POLICY.id, mapId: WORLD_REFERENCE_MAP_ID, mapSha256: WORLD_REFERENCE_MAP_SHA256, zoneId: appearance?.context?.zoneId || null, biomeKind: appearance?.context?.biomeKind || null, profileKey: appearance?.context?.profileKey || null, confidence: appearance?.context?.confidence ?? 0, textureSize: appearance?.recipe?.textureSize || null, recipeMode: appearance?.recipe?.mode || null, meshCount: audit.validation?.meshCount || 0, surfaceCount: audit.validation?.surfaceCount || 0, materialSlotCount: audit.validation?.materialSlotCount || 0, generatedMaterialCount: audit.validation?.generatedMaterialCount || 0, missingMaterialCount: 0, errors: Object.freeze([...audit.errors]), warnings: Object.freeze([...audit.warnings]) });
}
