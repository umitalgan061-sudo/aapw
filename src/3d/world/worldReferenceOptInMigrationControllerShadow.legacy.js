/**
 * Run 195 shadow-only opt-in replacement controller for the canonical full-reference candidate.
 *
 * The controller owns only scene membership and ground-collider routing. Existing live roots are
 * detached but never disposed, so rollback can restore the exact same object identities/order.
 * The canonical clipped window is always disposable and remains opt-in; no live runtime imports
 * this module.
 * @module world/worldReferenceOptInMigrationControllerShadow
 */

import {
	createClippedCanonicalWindowOwnershipHarness,
} from './worldReferenceClippedWindowOwnershipShadow.js';

export const OPT_IN_MIGRATION_CONTROLLER_SHADOW_POLICY = Object.freeze({
	key: 'run195-opt-in-migration-controller-shadow-v1',
	modeCurrent: 'current',
	modeCanonical: 'canonical',
});

function assertScene(scene) {
	if (!scene || typeof scene.add !== 'function' || typeof scene.remove !== 'function') {
		throw new TypeError('scene must be a THREE.Scene-compatible object');
	}
}

function assertCollider(collider, label) {
	if (!collider || typeof collider.getGroundHeight !== 'function') {
		throw new TypeError(`${label} must expose getGroundHeight(x,z)`);
	}
}

function snapshotRoots(scene, roots) {
	const unique = [...new Set(roots || [])];
	for (const root of unique) {
		if (!root || root.parent !== scene) throw new Error('every current root must be a direct child of scene');
	}
	return Object.freeze(unique.map((root) => Object.freeze({
		root,
		index: scene.children.indexOf(root),
		visible: root.visible,
	})));
}

function detachRoots(scene, snapshots) {
	for (const entry of snapshots) scene.remove(entry.root);
}

function restoreRoots(scene, snapshots) {
	for (const entry of snapshots) {
		entry.root.visible = entry.visible;
		scene.add(entry.root);
	}
	const restoredSet = new Set(snapshots.map((entry) => entry.root));
	const unaffected = scene.children.filter((child) => !restoredSet.has(child));
	const slots = new Map(snapshots.map((entry) => [entry.index, entry.root]));
	const rebuilt = [];
	let unaffectedIndex = 0;
	const targetLength = unaffected.length + snapshots.length;
	for (let index = 0; index < targetLength; index += 1) {
		if (slots.has(index)) rebuilt.push(slots.get(index));
		else rebuilt.push(unaffected[unaffectedIndex++]);
	}
	while (unaffectedIndex < unaffected.length) rebuilt.push(unaffected[unaffectedIndex++]);
	scene.children.splice(0, scene.children.length, ...rebuilt);
}

/**
 * Builds a reversible replacement boundary. The current roots/collider are borrowed, not owned.
 * Canonical resources are owned by the controller and disposed on rollback/dispose.
 */
export function createOptInMigrationControllerShadow({
	scene,
	currentRoots,
	currentGroundCollider,
	profile = 'mobile',
} = {}) {
	assertScene(scene);
	assertCollider(currentGroundCollider, 'currentGroundCollider');
	const rootSnapshots = snapshotRoots(scene, currentRoots);
	const canonicalHarness = createClippedCanonicalWindowOwnershipHarness({ scene, profile });
	let mode = OPT_IN_MIGRATION_CONTROLLER_SHADOW_POLICY.modeCurrent;
	let canonicalActive = null;
	let disposed = false;
	const transitions = [];

	function assertUsable() {
		if (disposed) throw new Error('migration controller is disposed');
	}

	function activateCanonicalAtBridge(bridgeId) {
		assertUsable();
		if (mode === OPT_IN_MIGRATION_CONTROLLER_SHADOW_POLICY.modeCanonical) {
			throw new Error('canonical candidate already active; rollback before another activation');
		}
		detachRoots(scene, rootSnapshots);
		try {
			canonicalActive = canonicalHarness.replaceAtBridge(bridgeId);
			mode = OPT_IN_MIGRATION_CONTROLLER_SHADOW_POLICY.modeCanonical;
			transitions.push(Object.freeze({ type: 'activate', bridgeId, generation: canonicalActive.generation }));
			return canonicalActive;
		} catch (error) {
			restoreRoots(scene, rootSnapshots);
			throw error;
		}
	}

	function rollbackToCurrent() {
		assertUsable();
		if (mode === OPT_IN_MIGRATION_CONTROLLER_SHADOW_POLICY.modeCurrent) return null;
		const disposedCanonical = canonicalHarness.dispose();
		canonicalActive = null;
		restoreRoots(scene, rootSnapshots);
		mode = OPT_IN_MIGRATION_CONTROLLER_SHADOW_POLICY.modeCurrent;
		transitions.push(Object.freeze({
			type: 'rollback',
			generation: disposedCanonical?.generation || null,
			canonicalDisposed: disposedCanonical?.disposed === true,
		}));
		return disposedCanonical;
	}

	function getGroundCollider() {
		assertUsable();
		if (mode === OPT_IN_MIGRATION_CONTROLLER_SHADOW_POLICY.modeCurrent) return currentGroundCollider;
		const collider = canonicalActive?.windowState?.groundCollider;
		assertCollider(collider, 'canonicalGroundCollider');
		return collider;
	}

	function dispose() {
		if (disposed) return;
		if (mode === OPT_IN_MIGRATION_CONTROLLER_SHADOW_POLICY.modeCanonical) rollbackToCurrent();
		canonicalHarness.dispose();
		disposed = true;
	}

	return Object.freeze({
		version: OPT_IN_MIGRATION_CONTROLLER_SHADOW_POLICY.key,
		profile,
		activateCanonicalAtBridge,
		rollbackToCurrent,
		getGroundCollider,
		dispose,
		getMode() { return mode; },
		getActiveCanonical() { return canonicalActive; },
		getCurrentRootSnapshots() { return rootSnapshots; },
		getTransitions() { return Object.freeze([...transitions]); },
		isDisposed() { return disposed; },
	});
}
