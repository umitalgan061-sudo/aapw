/**
 * Run198 v3 opt-in lifecycle safety layer for the proven Run197 current-tick ownership gate.
 *
 * The default runtime never imports this module. A developer/preflight path may use it to keep
 * every current ChunkManager mutation entry point inert while canonical ownership is active, then
 * dispose the Run197 gate during pagehide capture before the unchanged game3d.js teardown runs.
 * Exact instance method identity is restored before current teardown is allowed to dispose chunks.
 * @module world/worldReferenceLifecycleChunkFreezeShadow
 */

export const LIFECYCLE_CHUNK_FREEZE_SHADOW_POLICY = Object.freeze({
	key: 'run198-lifecycle-chunk-freeze-shadow-v1',
	modeCurrent: 'current',
	modeCanonical: 'canonical',
});

const MUTATOR_METHODS = Object.freeze(['loadChunk', 'loadSquare', 'unloadChunk', 'disposeAll']);

function assertState(state) {
	if (!state?.chunkManager?.loaded || !(state.chunkManager.loaded instanceof Map)) {
		throw new TypeError('state.chunkManager.loaded Map is required');
	}
	for (const name of MUTATOR_METHODS) {
		if (typeof state.chunkManager[name] !== 'function') throw new TypeError(`state.chunkManager.${name} is required`);
	}
}

function assertGate(gate) {
	for (const name of ['activateCanonicalAtBridge', 'rollbackToCurrent', 'getMode', 'dispose', 'isDisposed']) {
		if (typeof gate?.[name] !== 'function') throw new TypeError(`gate.${name} is required`);
	}
}

function assertEventTarget(eventTarget) {
	if (!eventTarget || typeof eventTarget.addEventListener !== 'function' || typeof eventTarget.removeEventListener !== 'function') {
		throw new TypeError('eventTarget must expose addEventListener/removeEventListener');
	}
}

function sortedLoadedKeys(chunkManager) {
	return [...chunkManager.loaded.keys()].sort();
}

function installPause(target, methodName) {
	const own = Object.getOwnPropertyDescriptor(target, methodName) || null;
	const original = target[methodName];
	let blockedCalls = 0;
	let restored = false;
	const replacement = function run198LifecycleChunkMutationPaused() {
		blockedCalls += 1;
		return undefined;
	};
	Object.defineProperty(target, methodName, {
		configurable: true,
		enumerable: own?.enumerable ?? false,
		writable: true,
		value: replacement,
	});
	return Object.freeze({
		methodName,
		original,
		replacement,
		getStats: () => Object.freeze({ blockedCalls, restored }),
		restore() {
			if (restored) return;
			if (target[methodName] !== replacement) throw new Error(`chunkManager.${methodName} changed while lifecycle freeze was active`);
			if (own) Object.defineProperty(target, methodName, own);
			else delete target[methodName];
			if (target[methodName] !== original) throw new Error(`chunkManager.${methodName} identity was not restored`);
			restored = true;
		},
	});
}

function restorePauses(pauses) {
	for (const pause of [...pauses].reverse()) pause.restore();
}

/**
 * Wraps the Run197 gate with a stronger lifecycle ownership boundary. The wrapper adds no runtime
 * behavior unless an explicit preflight caller invokes activateCanonicalAtBridge().
 */
export function createLifecycleChunkFreezeShadow({ state, gate, eventTarget = globalThis.window } = {}) {
	assertState(state);
	assertGate(gate);
	assertEventTarget(eventTarget);
	let pauses = [];
	let residentKeys = null;
	let disposed = false;
	let pagehideCount = 0;
	let gateDisposeCount = 0;
	let lastModeBeforeDispose = null;
	const transitions = [];

	function assertUsable() {
		if (disposed) throw new Error('lifecycle chunk freeze shadow is disposed');
	}

	function assertResidentStable() {
		if (!residentKeys) return true;
		const current = sortedLoadedKeys(state.chunkManager);
		if (JSON.stringify(current) !== JSON.stringify(residentKeys)) {
			throw new Error(`current ChunkManager resident keys drifted during canonical lifecycle freeze: ${residentKeys.length}->${current.length}`);
		}
		return true;
	}

	function activateCanonicalAtBridge(bridgeId) {
		assertUsable();
		if (pauses.length || gate.getMode() === LIFECYCLE_CHUNK_FREEZE_SHADOW_POLICY.modeCanonical) {
			throw new Error('canonical lifecycle chunk freeze already active');
		}
		residentKeys = sortedLoadedKeys(state.chunkManager);
		pauses = MUTATOR_METHODS.map((name) => installPause(state.chunkManager, name));
		try {
			const active = gate.activateCanonicalAtBridge(bridgeId);
			transitions.push(Object.freeze({ type: 'activate', bridgeId, residentCount: residentKeys.length, pausedMutators: pauses.length }));
			return active;
		} catch (error) {
			restorePauses(pauses);
			pauses = [];
			residentKeys = null;
			throw error;
		}
	}

	function rollbackToCurrent() {
		assertUsable();
		if (gate.getMode() !== LIFECYCLE_CHUNK_FREEZE_SHADOW_POLICY.modeCanonical) return null;
		assertResidentStable();
		const result = gate.rollbackToCurrent();
		restorePauses(pauses);
		transitions.push(Object.freeze({ type: 'rollback', residentCount: residentKeys.length, mutatorIdentityRestored: true }));
		pauses = [];
		residentKeys = null;
		return result;
	}

	function disposeGate(reason) {
		if (gate.isDisposed()) return false;
		lastModeBeforeDispose = gate.getMode();
		if (lastModeBeforeDispose === LIFECYCLE_CHUNK_FREEZE_SHADOW_POLICY.modeCanonical) assertResidentStable();
		gate.dispose();
		gateDisposeCount += 1;
		restorePauses(pauses);
		transitions.push(Object.freeze({ type: 'dispose', reason, modeBefore: lastModeBeforeDispose, mutatorIdentityRestored: true }));
		pauses = [];
		residentKeys = null;
		return true;
	}

	function onPagehide() {
		pagehideCount += 1;
		disposeGate('pagehide');
		eventTarget.removeEventListener('pagehide', onPagehide, true);
		disposed = true;
	}

	eventTarget.addEventListener('pagehide', onPagehide, { capture: true, once: true });

	function dispose() {
		if (disposed) return;
		eventTarget.removeEventListener('pagehide', onPagehide, true);
		disposeGate('manual');
		disposed = true;
	}

	return Object.freeze({
		version: LIFECYCLE_CHUNK_FREEZE_SHADOW_POLICY.key,
		activateCanonicalAtBridge,
		rollbackToCurrent,
		assertResidentStable,
		getMode: () => gate.getMode(),
		getMutationStats: () => Object.freeze(Object.fromEntries(pauses.map((pause) => [pause.methodName, pause.getStats()]))),
		getTransitions: () => Object.freeze([...transitions]),
		getStats: () => Object.freeze({ pagehideCount, gateDisposeCount, lastModeBeforeDispose, gateDisposed: gate.isDisposed(), coordinatorDisposed: disposed }),
		dispose,
		isDisposed: () => disposed,
	});
}
