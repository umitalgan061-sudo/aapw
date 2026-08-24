/**
 * Runtime foundation-to-terrain bridge.
 *
 * `WorldAssetPlacementPipeline` discovers a structure's world-space footprint while terrain rendering
 * and physics already share one mutable `flattenPads` authority. This module deliberately mutates that
 * existing array instead of creating a second height system.
 *
 * Runtime structure foundations use an adaptive four-cell circle union over the AABB. Near-square
 * footprints use a 2x2 grid; long/narrow footprints rotate the same four-pad budget into 4x1 or 1x4.
 * Every circle encloses its rectangular cell, so the full base stays flat while narrow structures avoid
 * the side overreach a forced 2x2 grid still produced. Legacy authored seat/castle pads remain ordinary
 * circles and continue to work unchanged in `createHeightSampler`.
 * @module world/terrainFoundationConformer
 */

export const TERRAIN_FOUNDATION_CONFORM_POLICY = Object.freeze({
	id: 'runtime-structure-foundation-conform-2026-08-24-v9-adaptive-cell-safety',
	footprintMode: 'aabb-adaptive-four-cell-circle-union',
	defaultClusterColumns: 2,
	defaultClusterRows: 2,
	longAxisClusterCells: 4,
	longAxisAspectThreshold: 2.5,
	maximumClusterPads: 4,
	chunkRebuildMode: 'union-deduplicated',
	batchRemovalMode: 'mutate-all-then-union-rebuild',
	shutdownRemovalMode: 'mutate-without-rebuild',
	identityMode: 'runtime-object-first',
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

function enclosingRadius(bounds, innerMarginMeters) {
	const halfWidth = (bounds.maxX - bounds.minX) * 0.5;
	const halfDepth = (bounds.maxZ - bounds.minZ) * 0.5;
	return Math.hypot(halfWidth, halfDepth) + innerMarginMeters;
}

function structureKey(payload) {
	const uuid = payload?.object?.uuid;
	if (uuid) return `object:${uuid}`;
	const explicit = payload?.metadata?.instanceId ?? payload?.metadata?.placementId ?? payload?.metadata?.id ?? payload?.metadata?.assetId;
	if (explicit !== null && explicit !== undefined && String(explicit).trim()) return `asset:${String(explicit)}`;
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
		: rememberedStructureKey(object) || (object?.uuid ? `object:${object.uuid}` : null);
	return { key, object };
}

function chooseAdaptiveGrid(width, depth) {
	if (width <= 0 && depth <= 0) return { columns: 1, rows: 1 };
	if (depth <= 0) return { columns: TERRAIN_FOUNDATION_CONFORM_POLICY.longAxisClusterCells, rows: 1 };
	if (width <= 0) return { columns: 1, rows: TERRAIN_FOUNDATION_CONFORM_POLICY.longAxisClusterCells };
	const aspect = width / depth;
	if (aspect >= TERRAIN_FOUNDATION_CONFORM_POLICY.longAxisAspectThreshold) {
		return { columns: TERRAIN_FOUNDATION_CONFORM_POLICY.longAxisClusterCells, rows: 1 };
	}
	if (aspect <= 1 / TERRAIN_FOUNDATION_CONFORM_POLICY.longAxisAspectThreshold) {
		return { columns: 1, rows: TERRAIN_FOUNDATION_CONFORM_POLICY.longAxisClusterCells };
	}
	return {
		columns: TERRAIN_FOUNDATION_CONFORM_POLICY.defaultClusterColumns,
		rows: TERRAIN_FOUNDATION_CONFORM_POLICY.defaultClusterRows,
	};
}

function createAdaptiveCellPads(bounds, targetHeight, key, safeInnerMargin, safeFeather) {
	const width = bounds.maxX - bounds.minX;
	const depth = bounds.maxZ - bounds.minZ;
	const { columns, rows } = chooseAdaptiveGrid(width, depth);
	const cellWidth = width / columns;
	const cellDepth = depth / rows;
	const cellRadius = Math.max(
		TERRAIN_FOUNDATION_CONFORM_POLICY.minimumInnerRadiusMeters,
		Math.hypot(cellWidth * 0.5, cellDepth * 0.5) + safeInnerMargin,
	);
	const pads = [];
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			pads.push({
				x: columns === 1 ? (bounds.minX + bounds.maxX) * 0.5 : bounds.minX + cellWidth * (column + 0.5),
				z: rows === 1 ? (bounds.minZ + bounds.maxZ) * 0.5 : bounds.minZ + cellDepth * (row + 0.5),
				innerRadiusMeters: cellRadius,
				outerRadiusMeters: cellRadius + safeFeather,
				anchorHeightMeters: targetHeight,
				source: TERRAIN_FOUNDATION_CONFORM_POLICY.id,
				foundationKey: key,
				foundationClusterIndex: pads.length,
				foundationClusterSize: columns * rows,
				footprintBounds: { ...bounds },
			});
		}
	}
	return pads;
}

/**
 * Converts one structure footprint into a compact circle union consumed by the existing terrain
 * height sampler. `pad` remains a compatibility envelope descriptor; `pads` is the installed cluster.
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
	const requestedEnvelopeRadius = Math.max(
		TERRAIN_FOUNDATION_CONFORM_POLICY.minimumInnerRadiusMeters,
		enclosingRadius(bounds, safeInnerMargin),
	);
	const x = (bounds.minX + bounds.maxX) * 0.5;
	const z = (bounds.minZ + bounds.maxZ) * 0.5;
	const key = structureKey(payload);
	const pads = createAdaptiveCellPads(bounds, targetHeight, key, safeInnerMargin, safeFeather);
	const requestedCellRadius = Math.max(...pads.map((pad) => pad.innerRadiusMeters));
	if (requestedCellRadius > safeMaximum) {
		return {
			ok: false,
			error: 'foundation-footprint-too-large',
			requestedInnerRadiusMeters: requestedCellRadius,
			maximumInnerRadiusMeters: safeMaximum,
		};
	}

	return {
		ok: true,
		key,
		pads,
		pad: {
			x,
			z,
			innerRadiusMeters: requestedEnvelopeRadius,
			outerRadiusMeters: requestedEnvelopeRadius + safeFeather,
			anchorHeightMeters: targetHeight,
			source: TERRAIN_FOUNDATION_CONFORM_POLICY.id,
			foundationKey: key,
			foundationClusterSize: pads.length,
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

export function rebuildChunksForFoundations(chunkManager, pads, chunkSizeMeters) {
	if (!chunkManager?.loaded || typeof chunkManager.unloadChunk !== 'function' || typeof chunkManager.loadChunk !== 'function') return 0;
	const size = finiteNumber(chunkSizeMeters ?? chunkManager.chunkSizeMeters);
	if (size === null || size <= 0) return 0;
	const validPads = (Array.isArray(pads) ? pads : [pads]).flat().filter((pad) => (
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

export function rebuildChunksForFoundation(chunkManager, pad, chunkSizeMeters) {
	return rebuildChunksForFoundations(chunkManager, [pad], chunkSizeMeters);
}

export function createTerrainFoundationConformer({
	flattenPads,
	chunkManager = null,
	chunkSizeMeters = null,
	innerMarginMeters = TERRAIN_FOUNDATION_CONFORM_POLICY.defaultInnerMarginMeters,
	featherMeters = TERRAIN_FOUNDATION_CONFORM_POLICY.defaultFeatherMeters,
	maximumInnerRadiusMeters = TERRAIN_FOUNDATION_CONFORM_POLICY.maximumInnerRadiusMeters,
} = {}) {
	if (!Array.isArray(flattenPads)) throw new TypeError('terrainFoundationConformer: flattenPads must be a mutable array');
	const dynamicPadClusters = new Map();

	function removeInstalledPad(key, { rebuild = true } = {}) {
		const pads = key ? dynamicPadClusters.get(key) : null;
		if (!pads?.length) return { ok: false, error: 'foundation-not-found', rebuiltChunkCount: 0 };
		for (const pad of pads) {
			const index = flattenPads.indexOf(pad);
			if (index >= 0) flattenPads.splice(index, 1);
		}
		dynamicPadClusters.delete(key);
		const rebuiltChunkCount = rebuild ? rebuildChunksForFoundations(chunkManager, pads, chunkSizeMeters) : 0;
		return { ok: true, pad: pads[0], pads, rebuiltChunkCount };
	}

	function installPad(payload) {
		const created = createFoundationFlattenPad(payload, { innerMarginMeters, featherMeters, maximumInnerRadiusMeters });
		if (!created.ok) return created;
		const { key, pads } = created;
		const object = payload?.object || null;
		const previousObjectKey = rememberedStructureKey(object);
		const staleInfluencePads = [];

		if (previousObjectKey && previousObjectKey !== key && dynamicPadClusters.has(previousObjectKey)) {
			const retired = removeInstalledPad(previousObjectKey, { rebuild: false });
			if (retired.ok) staleInfluencePads.push(...retired.pads);
		}

		const previousPads = key ? dynamicPadClusters.get(key) : null;
		if (previousPads?.length) {
			staleInfluencePads.push(...previousPads.map((pad) => ({ ...pad })));
			for (const pad of previousPads) {
				const index = flattenPads.indexOf(pad);
				if (index >= 0) flattenPads.splice(index, 1);
			}
		}

		flattenPads.push(...pads);
		if (key) dynamicPadClusters.set(key, pads);

		if (object && key) {
			object.userData ||= {};
			object.userData.terrainFoundationKey = key;
		}

		const rebuiltChunkCount = rebuildChunksForFoundations(
			chunkManager,
			[...staleInfluencePads, ...pads],
			chunkSizeMeters,
		);

		return {
			ok: true,
			height: pads[0].anchorHeightMeters,
			pad: pads[0],
			pads: [...pads],
			rebuiltChunkCount,
		};
	}

	function removeFoundations(inputs, { rebuild = true } = {}) {
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
			removedPads.push(...removed.pads);
			if (object) removedObjects.push({ object, key });
		}

		for (const { object, key } of removedObjects) {
			if (object?.userData?.terrainFoundationKey === key) delete object.userData.terrainFoundationKey;
		}

		const rebuiltChunkCount = rebuild
			? rebuildChunksForFoundations(chunkManager, removedPads, chunkSizeMeters)
			: 0;
		return {
			ok: missingKeys.length === 0,
			removedCount: removedPads.length,
			missingKeys,
			rebuiltChunkCount,
			rebuildSkipped: !rebuild && removedPads.length > 0,
		};
	}

	function removeFoundation(keyOrObject) {
		const { key, object } = foundationKeyFromInput(keyOrObject);
		if (!key) return { ok: false, error: 'foundation-missing-key' };
		const removed = removeInstalledPad(key);
		if (!removed.ok) return removed;
		if (object?.userData?.terrainFoundationKey === key) delete object.userData.terrainFoundationKey;
		return { ok: true, removedCount: removed.pads.length, rebuiltChunkCount: removed.rebuiltChunkCount };
	}

	return Object.freeze({
		conformTerrain: installPad,
		removeFoundation,
		removeFoundations,
		getDynamicPads: () => [...dynamicPadClusters.values()].flat(),
		policy: TERRAIN_FOUNDATION_CONFORM_POLICY,
	});
}
