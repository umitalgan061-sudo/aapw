/**
 * Run197 opt-in shadow gate for the unchanged live game3d tick chain.
 *
 * This module is never imported by the default runtime. A developer/preflight harness may compose
 * it with Run196's current-runtime transaction so the real game tick keeps executing while every
 * current simulation-owned update entry point is instance-paused. Rollback restores exact method
 * identity; no prototype, source module, scene resource, or default import graph is changed.
 * @module world/worldReferenceCurrentTickOwnershipShadow
 */

export const CURRENT_TICK_OWNERSHIP_SHADOW_POLICY = Object.freeze({
	key: 'run197-current-tick-ownership-shadow-v1',
	modeCurrent: 'current',
	modeCanonical: 'canonical',
});

const ENTITY_COLLECTIONS = Object.freeze([
	['npcs', 'npc'],
	['animals', 'animal'],
	['dragons', 'dragon'],
]);

function assertIntegration(integration) {
	for (const name of ['activateCanonicalAtBridge', 'rollbackToCurrent', 'getMode', 'dispose']) {
		if (typeof integration?.[name] !== 'function') throw new TypeError(`integration.${name} is required`);
	}
}

function assertState(state) {
	if (!state?.keyboardInput || typeof state.keyboardInput.getAxes !== 'function') {
		throw new TypeError('state.keyboardInput.getAxes is required');
	}
	if (!state.player || typeof state.player.update !== 'function') throw new TypeError('state.player.update is required');
	if (!state.interaction || typeof state.interaction.update !== 'function') throw new TypeError('state.interaction.update is required');
	if (!state.worldEvents || typeof state.worldEvents.update !== 'function') throw new TypeError('state.worldEvents.update is required');
	for (const [field] of ENTITY_COLLECTIONS) {
		if (!Array.isArray(state[field])) throw new TypeError(`state.${field} must be an array`);
		for (const entity of state[field]) {
			if (typeof entity?.update !== 'function') throw new TypeError(`state.${field} contains an entity without update()`);
		}
	}
}

function installInstanceMethodPause(target, methodName, label, replacementFactory) {
	const ownDescriptor = Object.getOwnPropertyDescriptor(target, methodName) || null;
	const originalMethod = target[methodName];
	if (typeof originalMethod !== 'function') throw new TypeError(`${label}.${methodName} must be a function`);
	const stats = { blockedCalls: 0, restored: false };
	const replacement = replacementFactory(stats);
	Object.defineProperty(target, methodName, {
		configurable: true,
		enumerable: ownDescriptor?.enumerable ?? false,
		writable: true,
		value: replacement,
	});
	return Object.freeze({
		label,
		methodName,
		target,
		originalMethod,
		replacement,
		getStats: () => Object.freeze({ blockedCalls: stats.blockedCalls, restored: stats.restored }),
		restore() {
			if (stats.restored) return;
			if (target[methodName] !== replacement) throw new Error(`${label}.${methodName} changed while paused`);
			if (ownDescriptor) Object.defineProperty(target, methodName, ownDescriptor);
			else delete target[methodName];
			if (target[methodName] !== originalMethod) throw new Error(`${label}.${methodName} identity was not restored`);
			stats.restored = true;
		},
	});
}

function captureObjectTransform(object3D) {
	if (!object3D?.position || !object3D?.quaternion) return null;
	return Object.freeze({
		position: Object.freeze(object3D.position.toArray()),
		quaternion: Object.freeze(object3D.quaternion.toArray()),
	});
}

function captureSimulationSnapshot(state) {
	return Object.freeze({
		player: captureObjectTransform(state.player.object3D),
		npcs: Object.freeze(state.npcs.map((entity) => captureObjectTransform(entity.object3D))),
		animals: Object.freeze(state.animals.map((entity) => captureObjectTransform(entity.object3D))),
		dragons: Object.freeze(state.dragons.map((entity) => captureObjectTransform(entity.object3D))),
		keyboardInput: state.keyboardInput,
		touchJoystick: state.touchJoystick || null,
		interaction: state.interaction,
		worldEvents: state.worldEvents,
		entityRefs: Object.freeze(Object.fromEntries(ENTITY_COLLECTIONS.map(([field]) => [field, Object.freeze([...state[field]])]))),
	});
}

function assertEntityIdentityStable(state, snapshot) {
	for (const [field] of ENTITY_COLLECTIONS) {
		const before = snapshot.entityRefs[field];
		const after = state[field];
		if (after.length !== before.length || after.some((entity, index) => entity !== before[index])) {
			throw new Error(`state.${field} entity identity changed while canonical mode was active`);
		}
	}
	if (state.keyboardInput !== snapshot.keyboardInput) throw new Error('keyboard input identity changed while canonical mode was active');
	if ((state.touchJoystick || null) !== snapshot.touchJoystick) throw new Error('touch input identity changed while canonical mode was active');
	if (state.interaction !== snapshot.interaction) throw new Error('interaction identity changed while canonical mode was active');
	if (state.worldEvents !== snapshot.worldEvents) throw new Error('world-event identity changed while canonical mode was active');
}

function installTickPauses(state) {
	const pauses = [];
	pauses.push(installInstanceMethodPause(
		state.keyboardInput,
		'getAxes',
		'keyboardInput',
		(stats) => function getAxesPausedRun197() {
			stats.blockedCalls += 1;
			return { forward: 0, strafe: 0, running: false, jumpRequested: false };
		},
	));
	if (state.touchJoystick?.getAxes) {
		pauses.push(installInstanceMethodPause(
			state.touchJoystick,
			'getAxes',
			'touchJoystick',
			(stats) => function getAxesPausedRun197() {
				stats.blockedCalls += 1;
				return { forward: 0, strafe: 0, running: false };
			},
		));
	}
	if (state.touchJoystick?.consumeJumpRequested) {
		pauses.push(installInstanceMethodPause(
			state.touchJoystick,
			'consumeJumpRequested',
			'touchJoystick',
			(stats) => function consumeJumpRequestedPausedRun197() {
				stats.blockedCalls += 1;
				return false;
			},
		));
	}
	pauses.push(installInstanceMethodPause(
		state.player,
		'update',
		'player',
		(stats) => function updatePausedRun197() { stats.blockedCalls += 1; },
	));
	for (const [field, singular] of ENTITY_COLLECTIONS) {
		state[field].forEach((entity, index) => pauses.push(installInstanceMethodPause(
			entity,
			'update',
			`${singular}:${index}`,
			(stats) => function updatePausedRun197() { stats.blockedCalls += 1; },
		)));
	}
	pauses.push(installInstanceMethodPause(
		state.interaction,
		'update',
		'interaction',
		(stats) => function updatePausedRun197() { stats.blockedCalls += 1; },
	));
	pauses.push(installInstanceMethodPause(
		state.worldEvents,
		'update',
		'worldEvents',
		(stats) => function updatePausedRun197() { stats.blockedCalls += 1; },
	));
	return pauses;
}

function restorePauses(pauses) {
	for (const pause of [...pauses].reverse()) pause.restore();
}

/**
 * Composes Run196's ownership/streaming transaction with an instance-scoped simulation freeze.
 * The caller remains responsible for invoking this only from an explicit developer/preflight path.
 */
export function createCurrentTickOwnershipShadow({ state, integration } = {}) {
	assertState(state);
	assertIntegration(integration);
	let pauses = [];
	let snapshot = null;
	let disposed = false;
	const transitions = [];

	function assertUsable() {
		if (disposed) throw new Error('current tick ownership shadow is disposed');
	}

	function isCanonicalActive() {
		return integration.getMode() === CURRENT_TICK_OWNERSHIP_SHADOW_POLICY.modeCanonical;
	}

	function getFreezeStats() {
		return Object.freeze(Object.fromEntries(pauses.map((pause) => [
			`${pause.label}.${pause.methodName}`,
			pause.getStats(),
		])));
	}

	function activateCanonicalAtBridge(bridgeId) {
		assertUsable();
		if (isCanonicalActive() || pauses.length) throw new Error('canonical tick ownership already active');
		snapshot = captureSimulationSnapshot(state);
		pauses = installTickPauses(state);
		try {
			const active = integration.activateCanonicalAtBridge(bridgeId);
			transitions.push(Object.freeze({ type: 'activate', bridgeId, pausedMethods: pauses.length }));
			return active;
		} catch (error) {
			restorePauses(pauses);
			pauses = [];
			snapshot = null;
			throw error;
		}
	}

	function rollbackToCurrent() {
		assertUsable();
		if (!isCanonicalActive()) return null;
		assertEntityIdentityStable(state, snapshot);
		const freezeStats = getFreezeStats();
		const result = integration.rollbackToCurrent();
		restorePauses(pauses);
		transitions.push(Object.freeze({ type: 'rollback', pausedMethods: pauses.length, methodIdentityRestored: true }));
		pauses = [];
		snapshot = null;
		return Object.freeze({ integration: result, freezeStats });
	}

	function dispose() {
		if (disposed) return;
		if (isCanonicalActive()) rollbackToCurrent();
		else if (pauses.length) {
			restorePauses(pauses);
			pauses = [];
		}
		integration.dispose();
		disposed = true;
	}

	return Object.freeze({
		version: CURRENT_TICK_OWNERSHIP_SHADOW_POLICY.key,
		activateCanonicalAtBridge,
		rollbackToCurrent,
		getMode: () => integration.getMode(),
		getFreezeStats,
		getTransitions: () => Object.freeze([...transitions]),
		getSimulationSnapshot: () => snapshot,
		dispose,
		isDisposed: () => disposed,
	});
}
