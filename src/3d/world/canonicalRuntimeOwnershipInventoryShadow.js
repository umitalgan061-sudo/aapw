/**
 * Run 196 shadow-only inventory for the live scene ownership surface that a future canonical-world
 * migration would have to suspend and restore. This module is intentionally not imported by the
 * live runtime; it only describes existing object ownership without mutating it.
 * @module world/canonicalRuntimeOwnershipInventoryShadow
 */

export const CANONICAL_RUNTIME_OWNERSHIP_INVENTORY_SHADOW_POLICY = Object.freeze({
	key: 'run196-canonical-runtime-ownership-inventory-shadow-v1',
	staticRootKeys: Object.freeze([
		'sky',
		'stars',
		'water',
		'river',
		'waterfalls',
		'settlements',
		'roads',
		'vegetation',
	]),
});

function assertObject(value, label) {
	if (!value || typeof value !== 'object') throw new TypeError(`${label} must be an object`);
}

function pushRoot(entries, seen, root, kind, key) {
	if (!root) return;
	if (seen.has(root)) throw new Error(`duplicate live root identity: ${kind}:${key}`);
	seen.add(root);
	entries.push(Object.freeze({ root, kind, key }));
}

/**
 * Enumerates the world-owned direct scene roots exposed by sceneManager.createScene(). Lights,
 * cameras and debug controls are deliberately not included: they are runtime infrastructure that
 * should remain alive while a future canonical world candidate owns only world presentation.
 */
export function buildCanonicalRuntimeOwnershipInventoryShadow(sceneState) {
	assertObject(sceneState, 'sceneState');
	assertObject(sceneState.scene, 'sceneState.scene');
	assertObject(sceneState.chunkManager, 'sceneState.chunkManager');
	if (!(sceneState.chunkManager.loaded instanceof Map)) {
		throw new TypeError('sceneState.chunkManager.loaded must be a Map');
	}

	const entries = [];
	const seen = new Set();
	for (const [chunkKey, mesh] of sceneState.chunkManager.loaded.entries()) {
		pushRoot(entries, seen, mesh, 'terrain-chunk', String(chunkKey));
	}
	for (const key of CANONICAL_RUNTIME_OWNERSHIP_INVENTORY_SHADOW_POLICY.staticRootKeys) {
		const value = sceneState[key];
		if (Array.isArray(value)) {
			value.forEach((root, index) => pushRoot(entries, seen, root, key, `${key}[${index}]`));
		} else {
			pushRoot(entries, seen, value, key, key);
		}
	}

	for (const entry of entries) {
		if (entry.root.parent !== sceneState.scene) {
			throw new Error(`live root is not a direct scene child: ${entry.kind}:${entry.key}`);
		}
	}

	const counts = Object.freeze(entries.reduce((result, entry) => {
		result[entry.kind] = (result[entry.kind] || 0) + 1;
		return result;
	}, {}));
	return Object.freeze({
		policy: CANONICAL_RUNTIME_OWNERSHIP_INVENTORY_SHADOW_POLICY.key,
		entries: Object.freeze(entries),
		counts,
		rootCount: entries.length,
		groundCollider: sceneState.groundCollider || null,
		chunkManager: sceneState.chunkManager,
	});
}

/**
 * Reports whether the three mutable runtime surfaces required for a lossless migration currently
 * expose explicit pause/snapshot/restore contracts. This is evidence only; it never patches live
 * objects and therefore cannot silently invent semantics for hidden state.
 */
export function inspectCanonicalRuntimeRestoreSurfaceShadow({ chunkManager, keyboardInput, player } = {}) {
	assertObject(chunkManager, 'chunkManager');
	assertObject(keyboardInput, 'keyboardInput');
	assertObject(player, 'player');
	const streaming = Object.freeze({
		pause: typeof chunkManager.pauseStreaming === 'function',
		resume: typeof chunkManager.resumeStreaming === 'function',
	});
	const input = Object.freeze({
		snapshot: typeof keyboardInput.snapshotState === 'function',
		restore: typeof keyboardInput.restoreState === 'function',
	});
	const physics = Object.freeze({
		snapshot: typeof player.snapshotPhysicsState === 'function',
		restore: typeof player.restorePhysicsState === 'function',
	});
	const blockers = Object.freeze([
		...(streaming.pause && streaming.resume ? [] : ['streaming-pause-resume']),
		...(input.snapshot && input.restore ? [] : ['input-snapshot-restore']),
		...(physics.snapshot && physics.restore ? [] : ['player-physics-snapshot-restore']),
	]);
	return Object.freeze({ streaming, input, physics, blockers, migrationReady: blockers.length === 0 });
}
