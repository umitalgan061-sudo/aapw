/**
 * Run197 shadow-only gameplay tick ownership boundary.
 *
 * This module composes Run196's current-runtime transaction with reversible, instance-scoped
 * update-method pauses for the exact gameplay object shapes called by game3d.js: player, NPCs,
 * animals, dragons, interaction, and world events. No live runtime imports this module.
 * @module world/worldReferenceGameplayTickFreezeShadow
 */
import { createCurrentRuntimeIntegrationShadow } from './worldReferenceCurrentRuntimeIntegrationShadow.js';

export const GAMEPLAY_TICK_FREEZE_SHADOW_POLICY = Object.freeze({
	key: 'run197-gameplay-tick-freeze-shadow-v1',
	modeCurrent: 'current',
	modeCanonical: 'canonical',
});

function assertUpdateTarget(target, label) {
	if (!target || typeof target.update !== 'function') throw new TypeError(`${label} must expose update()`);
}

function collectGameplayUpdateTargets(state) {
	assertUpdateTarget(state.player, 'player');
	assertUpdateTarget(state.worldEvents, 'worldEvents');
	assertUpdateTarget(state.interaction, 'interaction');
	const targets = [
		{ target: state.player, label: 'player' },
		{ target: state.interaction, label: 'interaction' },
		{ target: state.worldEvents, label: 'worldEvents' },
	];
	for (const [index, npc] of (state.npcs || []).entries()) {
		assertUpdateTarget(npc, `npc:${index}`);
		targets.push({ target: npc, label: `npc:${index}` });
	}
	for (const [index, animal] of (state.animals || []).entries()) {
		assertUpdateTarget(animal, `animal:${index}`);
		targets.push({ target: animal, label: `animal:${index}` });
	}
	for (const [index, dragon] of (state.dragons || []).entries()) {
		assertUpdateTarget(dragon, `dragon:${index}`);
		targets.push({ target: dragon, label: `dragon:${index}` });
	}
	return targets;
}

function installUpdatePause(target, label) {
	const ownDescriptor = Object.getOwnPropertyDescriptor(target, 'update') || null;
	const originalMethod = target.update;
	if (ownDescriptor && !('value' in ownDescriptor)) throw new Error(`${label}.update accessor is unsupported`);
	const stats = { blockedCalls: 0, lastArgs: null, resumed: false };
	const paused = function updatePausedRun197(...args) {
		stats.blockedCalls += 1;
		stats.lastArgs = [...args];
		return undefined;
	};
	if (ownDescriptor) {
		if (ownDescriptor.writable === false && ownDescriptor.configurable === false) {
			throw new Error(`${label}.update cannot be paused reversibly`);
		}
		Object.defineProperty(target, 'update', { ...ownDescriptor, value: paused });
	} else {
		if (!Object.isExtensible(target)) throw new Error(`${label} cannot receive reversible update pause`);
		Object.defineProperty(target, 'update', {
			value: paused,
			writable: true,
			configurable: true,
			enumerable: false,
		});
	}
	return Object.freeze({
		label,
		originalMethod,
		getStats() {
			return Object.freeze({
				label,
				blockedCalls: stats.blockedCalls,
				lastArgs: stats.lastArgs ? Object.freeze([...stats.lastArgs]) : null,
				resumed: stats.resumed,
			});
		},
		resume() {
			if (stats.resumed) return;
			if (ownDescriptor) Object.defineProperty(target, 'update', ownDescriptor);
			else delete target.update;
			if (target.update !== originalMethod) throw new Error(`${label}.update identity was not restored`);
			stats.resumed = true;
		},
	});
}

function installGameplayTickPause(state) {
	const entries = [];
	try {
		for (const entry of collectGameplayUpdateTargets(state)) {
			entries.push(installUpdatePause(entry.target, entry.label));
		}
	} catch (error) {
		for (const entry of [...entries].reverse()) entry.resume();
		throw error;
	}
	let resumed = false;
	return Object.freeze({
		getStats: () => Object.freeze(entries.map((entry) => entry.getStats())),
		resume() {
			if (resumed) return;
			for (const entry of [...entries].reverse()) entry.resume();
			resumed = true;
		},
		assertRestored() {
			for (const entry of entries) {
				if (!entry.getStats().resumed) throw new Error(`${entry.label}.update was not resumed`);
			}
		},
	});
}

/**
 * Creates a reversible opt-in preflight transaction that freezes the gameplay update methods
 * called from game3d.js while Run196 canonical ownership is active, then restores their exact
 * function identities on rollback.
 */
export function createGameplayTickFreezeShadow({ state, profile = 'mobile' } = {}) {
	const integration = createCurrentRuntimeIntegrationShadow({ state, profile });
	let tickPause = null;
	let disposed = false;
	const transitions = [];

	function assertUsable() {
		if (disposed) throw new Error('gameplay tick freeze shadow is disposed');
	}

	function isCanonicalActive() {
		return integration.getMode() === GAMEPLAY_TICK_FREEZE_SHADOW_POLICY.modeCanonical;
	}

	function activateCanonicalAtBridge(bridgeId) {
		assertUsable();
		if (isCanonicalActive()) throw new Error('canonical gameplay transaction already active');
		tickPause = installGameplayTickPause(state);
		try {
			const active = integration.activateCanonicalAtBridge(bridgeId);
			transitions.push(Object.freeze({ type: 'activate', bridgeId, generation: active.generation }));
			return active;
		} catch (error) {
			tickPause.resume();
			tickPause = null;
			throw error;
		}
	}

	function rollbackToCurrent() {
		assertUsable();
		if (!isCanonicalActive()) return null;
		const blocked = tickPause?.getStats() || Object.freeze([]);
		const result = integration.rollbackToCurrent();
		tickPause?.resume();
		tickPause?.assertRestored();
		transitions.push(Object.freeze({
			type: 'rollback',
			generation: result?.canonicalDisposed?.generation || null,
			blockedGameplayCalls: blocked.reduce((sum, entry) => sum + entry.blockedCalls, 0),
		}));
		tickPause = null;
		return Object.freeze({ integration: result, blocked });
	}

	function dispose() {
		if (disposed) return;
		if (isCanonicalActive()) rollbackToCurrent();
		tickPause?.resume();
		integration.dispose();
		disposed = true;
	}

	return Object.freeze({
		version: GAMEPLAY_TICK_FREEZE_SHADOW_POLICY.key,
		profile,
		inventory: integration.inventory,
		activateCanonicalAtBridge,
		rollbackToCurrent,
		getGroundCollider: integration.getGroundCollider,
		getMode: integration.getMode,
		shouldRunCurrentSimulation: integration.shouldRunCurrentSimulation,
		getGameplayPauseStats: () => tickPause?.getStats() || null,
		getStreamingPauseStats: integration.getStreamingPauseStats,
		getTransitions: () => Object.freeze([...transitions]),
		dispose,
		isDisposed: () => disposed,
	});
}
