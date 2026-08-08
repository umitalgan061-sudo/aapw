/**
 * Run 196 shadow-only integration boundary between the proven Run195 replacement controller and
 * the current runtime state shape. It inventories borrowed current scene roots, pauses only the
 * current ChunkManager instance while canonical ownership is active, freezes current input/player
 * update entry points, and restores current interaction/streaming state on rollback.
 *
 * No live runtime imports this module. It is an opt-in preflight contract only.
 * @module world/worldReferenceCurrentRuntimeIntegrationShadow
 */

import { createOptInMigrationControllerShadow } from './worldReferenceOptInMigrationControllerShadow.js';

export const CURRENT_RUNTIME_INTEGRATION_SHADOW_POLICY = Object.freeze({
	key: 'run196-current-runtime-integration-shadow-v1',
	modeCurrent: 'current',
	modeCanonical: 'canonical',
});

const OPTIONAL_ROOT_FIELDS = Object.freeze([
	['sky', 'sky'],
	['stars', 'stars'],
	['water', 'water'],
	['river', 'river'],
	['settlements', 'settlements'],
	['roads', 'roads'],
	['vegetation', 'vegetation'],
	['realCastles', 'real-castles'],
	['mobileSpawnVegetation', 'mobile-spawn-vegetation'],
]);

function assertRuntimeState(state) {
	if (!state?.scene || typeof state.scene.add !== 'function' || typeof state.scene.remove !== 'function') {
		throw new TypeError('state.scene must be THREE.Scene-compatible');
	}
	if (!state.chunkManager || typeof state.chunkManager.streamTowards !== 'function') {
		throw new TypeError('state.chunkManager must expose streamTowards');
	}
	if (!state.groundCollider || typeof state.groundCollider.getGroundHeight !== 'function') {
		throw new TypeError('state.groundCollider must expose getGroundHeight');
	}
	if (!state.controls?.target) throw new TypeError('state.controls.target is required');
	if (!state.camera?.position || !state.camera?.quaternion) throw new TypeError('state.camera transform is required');
}

function addRoot(entries, seen, scene, root, label) {
	if (!root || seen.has(root)) return;
	if (root.parent !== scene) throw new Error(`${label} must be a direct current scene child`);
	seen.add(root);
	entries.push({ root, label, index: scene.children.indexOf(root) });
}

/**
 * Builds the current-world ownership inventory from the real scene-state API shape. Terrain chunks
 * come from ChunkManager.loaded; named roots come from createScene/game3d state fields. Renderer,
 * camera, controls and lights stay infrastructure and are deliberately not replacement roots.
 */
export function buildCurrentSceneOwnershipInventory(state) {
	assertRuntimeState(state);
	const entries = [];
	const seen = new Set();
	for (const [key, label] of OPTIONAL_ROOT_FIELDS) addRoot(entries, seen, state.scene, state[key], label);
	for (const [index, waterfall] of (state.waterfalls || []).entries()) {
		addRoot(entries, seen, state.scene, waterfall, `waterfall:${index}`);
	}
	for (const [key, mesh] of state.chunkManager.loaded.entries()) {
		addRoot(entries, seen, state.scene, mesh, `terrain:${key}`);
	}
	addRoot(entries, seen, state.scene, state.player?.object3D, 'player');
	entries.sort((a, b) => a.index - b.index);
	return Object.freeze({
		roots: Object.freeze(entries.map((entry) => entry.root)),
		entries: Object.freeze(entries.map((entry) => Object.freeze({
			label: entry.label,
			index: entry.index,
			uuid: entry.root.uuid || null,
			name: entry.root.name || '',
		}))),
	});
}

function cloneVectorLike(value) {
	return value && typeof value.toArray === 'function' ? Object.freeze(value.toArray()) : null;
}

function restoreVectorLike(target, values) {
	if (!target || !values) return;
	if (typeof target.fromArray === 'function') target.fromArray(values);
	else if (typeof target.set === 'function') target.set(...values);
}

function sortedLoadedKeys(chunkManager) {
	return [...chunkManager.loaded.keys()].sort();
}

function captureCurrentRuntimeSnapshot(state) {
	return Object.freeze({
		lastStreamChunk: state.lastStreamChunk ? Object.freeze({ ...state.lastStreamChunk }) : null,
		controlsTarget: cloneVectorLike(state.controls.target),
		cameraPosition: cloneVectorLike(state.camera.position),
		cameraQuaternion: cloneVectorLike(state.camera.quaternion),
		playerPosition: cloneVectorLike(state.player?.object3D?.position),
		playerQuaternion: cloneVectorLike(state.player?.object3D?.quaternion),
		loadedKeys: Object.freeze(sortedLoadedKeys(state.chunkManager)),
		everGeneratedCount: state.chunkManager.everGeneratedCount,
		keyboardInput: state.keyboardInput || null,
		touchJoystick: state.touchJoystick || null,
		groundCollider: state.groundCollider,
	});
}

function assertCurrentChunkStateUnchanged(state, snapshot) {
	const loadedKeys = sortedLoadedKeys(state.chunkManager);
	if (JSON.stringify(loadedKeys) !== JSON.stringify(snapshot.loadedKeys)) {
		throw new Error('current ChunkManager resident ownership changed while canonical mode was active');
	}
	if (state.chunkManager.everGeneratedCount !== snapshot.everGeneratedCount) {
		throw new Error('current ChunkManager cumulative coverage changed while canonical mode was active');
	}
}

function restoreCurrentRuntimeSnapshot(state, snapshot) {
	assertCurrentChunkStateUnchanged(state, snapshot);
	state.lastStreamChunk = snapshot.lastStreamChunk ? { ...snapshot.lastStreamChunk } : null;
	restoreVectorLike(state.controls.target, snapshot.controlsTarget);
	restoreVectorLike(state.camera.position, snapshot.cameraPosition);
	restoreVectorLike(state.camera.quaternion, snapshot.cameraQuaternion);
	restoreVectorLike(state.player?.object3D?.position, snapshot.playerPosition);
	restoreVectorLike(state.player?.object3D?.quaternion, snapshot.playerQuaternion);
	if ((state.keyboardInput || null) !== snapshot.keyboardInput) throw new Error('keyboard input identity changed');
	if ((state.touchJoystick || null) !== snapshot.touchJoystick) throw new Error('touch input identity changed');
	if (state.groundCollider !== snapshot.groundCollider) throw new Error('current ground collider identity changed');
	// The exact camera transform is part of the borrowed current-runtime snapshot. Do not call
	// OrbitControls.update() here: that would derive a second transform from controls' internal
	// spherical/damping state after the snapshot has already been restored. The normal live tick may
	// call update next; the Run196 checker separately proves that first post-rollback update is inert.
	state.camera.updateMatrixWorld?.(true);
}

function installCurrentStreamingPause(chunkManager) {
	const ownDescriptor = Object.getOwnPropertyDescriptor(chunkManager, 'streamTowards') || null;
	const originalMethod = chunkManager.streamTowards;
	const stats = { blockedCalls: 0, lastBlockedArgs: null, resumed: false };
	chunkManager.streamTowards = function streamTowardsPausedRun196(...args) {
		stats.blockedCalls += 1;
		stats.lastBlockedArgs = [...args];
		return undefined;
	};
	return Object.freeze({
		getStats() {
			return Object.freeze({
				blockedCalls: stats.blockedCalls,
				lastBlockedArgs: stats.lastBlockedArgs ? Object.freeze([...stats.lastBlockedArgs]) : null,
				resumed: stats.resumed,
			});
		},
		resume() {
			if (stats.resumed) return;
			if (ownDescriptor) Object.defineProperty(chunkManager, 'streamTowards', ownDescriptor);
			else delete chunkManager.streamTowards;
			if (chunkManager.streamTowards !== originalMethod) throw new Error('ChunkManager streamTowards identity was not restored');
			stats.resumed = true;
		},
	});
}

/**
 * Creates the opt-in Run196 integration preflight. Current resources are borrowed and current
 * simulation entry points are frozen while canonical ownership is active. Rollback restores the
 * exact current scene/controller state snapshot and the original ChunkManager method identity.
 */
export function createCurrentRuntimeIntegrationShadow({ state, profile = 'mobile' } = {}) {
	assertRuntimeState(state);
	const inventory = buildCurrentSceneOwnershipInventory(state);
	const replacement = createOptInMigrationControllerShadow({
		scene: state.scene,
		currentRoots: inventory.roots,
		currentGroundCollider: state.groundCollider,
		profile,
	});
	let runtimeSnapshot = null;
	let streamingPause = null;
	let disposed = false;
	const transitions = [];

	function assertUsable() {
		if (disposed) throw new Error('current runtime integration shadow is disposed');
	}

	function isCanonicalActive() {
		return replacement.getMode() === CURRENT_RUNTIME_INTEGRATION_SHADOW_POLICY.modeCanonical;
	}

	function activateCanonicalAtBridge(bridgeId) {
		assertUsable();
		if (isCanonicalActive()) throw new Error('canonical integration already active');
		runtimeSnapshot = captureCurrentRuntimeSnapshot(state);
		streamingPause = installCurrentStreamingPause(state.chunkManager);
		try {
			const active = replacement.activateCanonicalAtBridge(bridgeId);
			transitions.push(Object.freeze({ type: 'activate', bridgeId, generation: active.generation }));
			return active;
		} catch (error) {
			streamingPause.resume();
			restoreCurrentRuntimeSnapshot(state, runtimeSnapshot);
			streamingPause = null;
			runtimeSnapshot = null;
			throw error;
		}
	}

	function rollbackToCurrent() {
		assertUsable();
		if (!isCanonicalActive()) return null;
		const pausedStats = streamingPause?.getStats() || null;
		const canonicalDisposed = replacement.rollbackToCurrent();
		streamingPause?.resume();
		restoreCurrentRuntimeSnapshot(state, runtimeSnapshot);
		transitions.push(Object.freeze({
			type: 'rollback',
			generation: canonicalDisposed?.generation || null,
			blockedStreamingCalls: pausedStats?.blockedCalls || 0,
			currentStateRestored: true,
		}));
		streamingPause = null;
		runtimeSnapshot = null;
		return Object.freeze({ canonicalDisposed, pausedStats });
	}

	function readCurrentKeyboardAxes() {
		assertUsable();
		if (isCanonicalActive()) {
			return Object.freeze({ forward: 0, strafe: 0, running: false, jumpRequested: false, frozen: true });
		}
		if (!state.keyboardInput?.getAxes) return Object.freeze({ forward: 0, strafe: 0, running: false, jumpRequested: false, frozen: false });
		return Object.freeze({ ...state.keyboardInput.getAxes(), frozen: false });
	}

	function runCurrentPlayerUpdate(...args) {
		assertUsable();
		if (isCanonicalActive()) return false;
		if (!state.player?.update) return false;
		state.player.update(...args);
		return true;
	}

	function dispose() {
		if (disposed) return;
		if (isCanonicalActive()) rollbackToCurrent();
		streamingPause?.resume();
		replacement.dispose();
		disposed = true;
	}

	return Object.freeze({
		version: CURRENT_RUNTIME_INTEGRATION_SHADOW_POLICY.key,
		profile,
		inventory,
		activateCanonicalAtBridge,
		rollbackToCurrent,
		getGroundCollider: () => replacement.getGroundCollider(),
		readCurrentKeyboardAxes,
		runCurrentPlayerUpdate,
		shouldRunCurrentSimulation: () => !isCanonicalActive(),
		getMode: () => replacement.getMode(),
		getStreamingPauseStats: () => streamingPause?.getStats() || null,
		getTransitions: () => Object.freeze([...transitions]),
		dispose,
		isDisposed: () => disposed,
	});
}
