/**
 * Runtime foundation-to-terrain bridge.
 *
 * `WorldAssetPlacementPipeline` can discover a structure's whole footprint, but terrain rendering and
 * physics only agree if the same height modification reaches both systems. The scene already solves
 * that problem for kingdom-seat castles by sharing one mutable `flattenPads` array between
 * `ChunkManager` and `createGroundCollider`. This module deliberately reuses that authority instead
 * of creating a second terrain system.
 *
 * A structure footprint is converted into a circular flatten pad large enough to enclose its full
 * world-space AABB. The target plane is the footprint's high-side sample supplied by the placement
 * pipeline. Because `createHeightSampler` reads the shared array on every query, physics immediately
 * sees a newly appended pad. Already-rendered terrain chunks are then rebuilt only where the pad can
 * influence them, so render geometry catches up to the same shared field.
 *
 * Circular pads are conservative: a rotated rectangle may flatten a little more terrain at its
 * corners, but it can never leave part of the building base outside the conformed ground. The outer
 * feather makes that small overreach visually natural instead of producing a vertical terrain step.
 * @module world/terrainFoundationConformer
 */

export const TERRAIN_FOUNDATION_CONFORM_POLICY = Object.freeze({
	id: 'runtime-structure-foundation-conform-2026-08-22-v4',
	footprintMode: 'aabb-enclosing-circle',
	chunkRebuildMode: 'union-deduplicated',
	batchRemovalMode: 'mutate-all-then-union-rebuild',
	defaultInnerMarginMeters: 0.75,
	defaultFeatherMeters: 14,
	minimumInnerRadiusMeters: 1.5,
	minimumFeatherMeters: 2,
	maximumInnerRadiusMeters: 180,
});

function finiteNumber(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function normalizedBounds(bounds) {
	if (!bounds || typeof bounds !== 'object') return null;
	const minX = finiteNumber(bounds.minX);
	const maxX = finiteNumber(bounds.maxX);
	const minZ = finiteNumber(bounds.minZ);
	const maxZ = finiteNumber(bounds.maxZ);
	if ([minX, maxX, minZ, maxZ].some((value) => value === null)) return null;
	if (maxX < minX || maxZ < minZ) return null;
	return { minX, maxX, minZ, maxZ };
}

function smoothPadRadius(bounds, innerMarginMeters) {
	const halfWidth = (bounds.maxX - bounds.minX) * 0.5;
	const halfDepth = (bounds.maxZ - bounds.minZ) * 0.5;
	return Math.hypot(halfWidth, halfDepth) + innerMarginMeters;
}

function structureKey(payload) {
	// Authored ids are instance identities when present. A source path is not: the same house/tower
	// model may be instantiated many times, so prefer the runtime object's UUID before falling back to
	// `src`. Otherwise grounding one clone would move the flatten pad away from another clone.
	const explicit = payload?.metadata?.id ?? payload?.metadata?.assetId;
	if (explicit !== null && explicit !== undefined && String(explicit).trim()) return `asset:${String(explicit)}`;
	const uuid = payload?.object?.uuid;
	if (uuid) return `object:${uuid}`;
	const src = payload?.metadata?.src;
	if (src !== null && src !== undefined && String(src).trim()) return `source:${String(src)}`;
	const bounds = normalizedBounds(payload?.bounds);
	if (!bounds) return null;
	return `bounds:${bounds.minX.toFixed(3)}:${bounds.maxX.toFixed(3)}:${bounds.minZ.toFixed(3)}:${bounds.maxZ.toFixed(3)}`;
}

function rememberedStructureKey(object) {
	const key = object?.userData?.terrainFoundationKey;
	return key !== null && key !== undefined && String(key).trim() ? String(key) : null;
}

function foundationKeyFromInput(keyOrObject) {
	const object = typeof keyOrObject === 'object' && keyOrObject ? keyOrObject : null;
	const key = typeof keyOrObject === 'string'
		? keyOrObject
		: rememberedStructureKey(object)
			|| (object?.uuid ? `object:${object.uuid}` : null);
	return { key, object };
}

/**
 * Converts a footprint payload from `WorldAssetPlacementPipeline` into the pad shape already consumed
 * by `world/terrain.js#createHeightSampler`.
 */
export function createFoundationFlattenPad(payload, {
	innerMarginMeters = TERRAIN_FOUNDATION_CONFORM_POLICY.defaultInnerMarginMeters,
	featherMeters = TERRAIN_FOUNDATION_CONFORM_POLICY.defaultFeatherMeters,
	maximumInnerRadiusMeters = TERRAIN_FOUNDATION_CONFORM_POLICY.maximumInnerRadiusMeters,
} = {}) {
	const bounds = normalizedBounds(payload?.bounds);
	const targetHeight = finiteNumber(payload?.targetHeight);
	if (!bounds) return { ok: false, error: 'foundation-invalid-bounds' };
	if (targetHeight === null) return { ok: false, error: 'foundation-invalid-target-height' };

	const safeInnerMargin = Math.max(0, finiteNumber(innerMarginMeters) ?? 0);
	const safeFeather = Math.max(
		TERRAIN_FOUNDATION_CONFORM_POLICY.minimumFeatherMeters,
		finiteNumber(featherMeters) ?? TERRAIN_FOUNDATION_CONFORM_POLICY.defaultFeatherMeters,
	);
	const safeMaximum = Math.max(
		TERRAIN_FOUNDATION_CONFORM_POLICY.minimumInnerRadiusMeters,
		finiteNumber(maximumInnerRadiusMeters) ?? TERRAIN_FOUNDATION_CONFORM_POLICY.maximumInnerRadiusMeters,
	);
	const requestedRadius = Math.max(
		TERRAIN_FOUNDATION_CONFORM_POLICY.minimumInnerRadiusMeters,
		smoothPadRadius(bounds, safeInnerMargin),
	);
	if (requestedRadius > safeMaximum) {
		return {
			ok: false,
			error: 'foundation-footprint-too-large',
			requestedInnerRadiusMeters: requestedRadius,
			maximumInnerRadiusMeters: safeMaximum,
		};
	}

	const x = (bounds.minX + bounds.maxX) * 0.5;
	const z = (bounds.minZ + bounds.maxZ) * 0.5;
	const key = structureKey(payload);
	return {
		ok: true,
		key,
		pad: {
			x,
			z,
			innerRadiusMeters: requestedRadius,
			outerRadiusMeters: requestedRadius + safeFeather,
			anchorHeightMeters: targetHeight,
			source: TERRAIN_FOUNDATION_CONFORM_POLICY.id,
			foundationKey: key,
			footprintBounds: { ...bounds },
		},
	};
}

function circleIntersectsChunk(pad, chunkX, chunkZ, chunkSizeMeters) {
	const half = chunkSizeMeters * 0.5;
	const centerX = chunkX * chunkSizeMeters;
	const centerZ = chunkZ * chunkSizeMeters;
	const closestX = Math.max(centerX - half, Math.min(pad.x, centerX + half));
	const closestZ = Math.max(centerZ - half, Math.min(pad.z, centerZ + half));
	return Math.hypot(pad.x - closestX, pad.z - closestZ) <= pad.outerRadiusMeters;
}

function parseChunkKey(key) {
	const [rawX, rawZ] = String(key).split(',');
	const x = Number(rawX);
	const z = Number(rawZ);
	return Number.isInteger(x) && Number.isInteger(z) ? { x, z } : null;
}

/**
 * Rebuilds each resident chunk at most once across every supplied foundation influence region.
 * This matters when a structure moves/scales within one chunk: old and new pads overlap heavily, and
 * doing one rebuild per pad would dispose/recreate the same GPU terrain twice for a single edit.
 */
export function rebuildChunksForFoundations(chunkManager, pads, chunkSizeMeters) {
	if (!chunkManager?.loaded || typeof chunkManager.unloadChunk !== 'function' || typeof chunkManager.loadChunk !== 'function') return 0;
	const size = finiteNumber(chunkSizeMeters ?? chunkManager.chunkSizeMeters);
	if (size === null || size <= 0) return 0;
	const validPads = (Array.isArray(pads) ? pads : [pads]).filter((pad) => (
		pad && Number.isFinite(Number(pad.x)) && Number.isFinite(Number(pad.z)) && Number.isFinite(Number(pad.outerRadiusMeters))
	));
	if (!validPads.length) return 0;

	const affected = [];
	for (const key of chunkManager.loaded.keys()) {
		const chunk = parseChunkKey(key);
		if (chunk && validPads.some((pad) => circleIntersectsChunk(pad, chunk.x, chunk.z, size))) affected.push(chunk);
	}
	for (const chunk of affected) chunkManager.unloadChunk(chunk.x, chunk.z);
	for (const chunk of affected) chunkManager.loadChunk(chunk.x, chunk.z);
	return affected.length;
}

/**
 * Rebuilds only resident chunks intersecting one foundation pad. Kept as the single-pad compatibility
 * entry point; internally it uses the same union-deduplicated rebuild path as structure updates.
 */
export function rebuildChunksForFoundation(chunkManager, pad, chunkSizeMeters) {
	return rebuildChunksForFoundations(chunkManager, [pad], chunkSizeMeters);
}

/**
 * Creates the callback consumed by `WorldAssetPlacementPipeline`'s `conformTerrain` option.
 *
 * IMPORTANT: `flattenPads` must be the exact same array used to construct both `ChunkManager` and the
 * ground collider. The caller should not replace that array after construction; mutation is expected.
 */
export function createTerrainFoundationConformer({
	flattenPads,
	chunkManager = null,
	chunkSizeMeters = null,
	innerMarginMeters = TERRAIN_FOUNDATION_CONFORM_POLICY.defaultInnerMarginMeters,
	featherMeters = TERRAIN_FOUNDATION_CONFORM_POLICY.defaultFeatherMeters,
	maximumInnerRadiusMeters = TERRAIN_FOUNDATION_CONFORM_POLICY.maximumInnerRadiusMeters,
} = {}) {
	if (!Array.isArray(flattenPads)) throw new TypeError('terrainFoundationConformer: flattenPads must be a mutable array');
	const dynamicPads = new Map();

	function removeInstalledPad(key, { rebuild = true } = {}) {
		const pad = key ? dynamicPads.get(key) : null;
		if (!pad) return { ok: false, error: 'foundation-not-found', rebuiltChunkCount: 0 };
		const index = flattenPads.indexOf(pad);
		if (index >= 0) flattenPads.splice(index, 1);
		dynamicPads.delete(key);
		const rebuiltChunkCount = rebuild ? rebuildChunksForFoundation(chunkManager, pad, chunkSizeMeters) : 0;
		return { ok: true, pad, rebuiltChunkCount };
	}

	function installPad(payload) {
		const created = createFoundationFlattenPad(payload, { innerMarginMeters, featherMeters, maximumInnerRadiusMeters });
		if (!created.ok) return created;
		const { key, pad } = created;
		const object = payload?.object || null;
		const previousObjectKey = rememberedStructureKey(object);
		const staleInfluencePads = [];

		if (previousObjectKey && previousObjectKey !== key && dynamicPads.has(previousObjectKey)) {
			const retired = removeInstalledPad(previousObjectKey, { rebuild: false });
			if (retired.ok) staleInfluencePads.push(retired.pad);
		}

		let installedPad = key ? dynamicPads.get(key) : null;
		let previousPad = null;
		if (installedPad) {
			previousPad = { ...installedPad };
			Object.assign(installedPad, pad);
		} else {
			installedPad = pad;
			flattenPads.push(installedPad);
			if (key) dynamicPads.set(key, installedPad);
		}

		if (object && key) {
			object.userData ||= {};
			object.userData.terrainFoundationKey = key;
		}

		const rebuiltChunkCount = rebuildChunksForFoundations(
			chunkManager,
			[...staleInfluencePads, previousPad, installedPad].filter(Boolean),
			chunkSizeMeters,
		);

		return {
			ok: true,
			height: installedPad.anchorHeightMeters,
			pad: installedPad,
			rebuiltChunkCount,
		};
	}

	function removeFoundations(inputs) {
		const requested = Array.isArray(inputs) ? inputs : [inputs];
		const removedPads = [];
		const removedObjects = [];
		const missingKeys = [];
		const seenKeys = new Set();

		for (const input of requested) {
			const { key, object } = foundationKeyFromInput(input);
			if (!key || seenKeys.has(key)) continue;
			seenKeys.add(key);
			const removed = removeInstalledPad(key, { rebuild: false });
			if (!removed.ok) {
				missingKeys.push(key);
				continue;
			}
			removedPads.push(removed.pad);
			if (object) removedObjects.push({ object, key });
		}

		for (const { object, key } of removedObjects) {
			if (object?.userData?.terrainFoundationKey === key) delete object.userData.terrainFoundationKey;
		}

		const rebuiltChunkCount = rebuildChunksForFoundations(chunkManager, removedPads, chunkSizeMeters);
		return {
			ok: missingKeys.length === 0,
			removedCount: removedPads.length,
			missingKeys,
			rebuiltChunkCount,
		};
	}

	function removeFoundation(keyOrObject) {
		const { key, object } = foundationKeyFromInput(keyOrObject);
		if (!key) return { ok: false, error: 'foundation-missing-key' };
		const removed = removeInstalledPad(key);
		if (!removed.ok) return removed;
		if (object?.userData?.terrainFoundationKey === key) delete object.userData.terrainFoundationKey;
		return { ok: true, rebuiltChunkCount: removed.rebuiltChunkCount };
	}

	return Object.freeze({
		conformTerrain: installPad,
		removeFoundation,
		removeFoundations,
		getDynamicPads: () => [...dynamicPads.values()],
		policy: TERRAIN_FOUNDATION_CONFORM_POLICY,
	});
}
