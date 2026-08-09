/**
 * Run200 opt-in canonical developer startup.
 *
 * This module is loaded only by game3d-canonical-dev.html. It registers the
 * canonical lifecycle owner before initGame3D(), waits for the unchanged current
 * runtime to finish booting, then transfers scene/tick ownership through the
 * already-proven Run196/197 transaction. Failure to activate canonical mode is
 * fail-safe: the current runtime remains active and the developer diagnostics
 * report current-fallback instead of changing the default player startup path.
 */
import { initGame3D } from '../src/3d/game3d.js';
import { gameEvents } from '../src/3d/eventBus.js';
import { EVENTS } from '../src/3d/config.js';
import { buildClippedBridgeOwnershipTargets } from '../src/3d/world/worldReferenceClippedWindowOwnershipShadow.js';
import { createCurrentRuntimeIntegrationShadow } from '../src/3d/world/worldReferenceCurrentRuntimeIntegrationShadow.js';
import { createCurrentTickOwnershipShadow } from '../src/3d/world/worldReferenceCurrentTickOwnershipShadow.js';

export const RUN200_CANONICAL_STARTUP_POLICY = Object.freeze({
	key: 'run200-canonical-developer-startup-v1',
	preferredBridgeId: 'cersei->stannis#1',
	profile: 'mobile',
});

function chooseBridgeId() {
	const targets = buildClippedBridgeOwnershipTargets();
	if (!targets.length) throw new Error('canonical bridge ownership targets unavailable');
	const preferred = targets.find((entry) => entry.bridgeId === RUN200_CANONICAL_STARTUP_POLICY.preferredBridgeId);
	return (preferred || [...targets].sort((a, b) => a.bridgeId.localeCompare(b.bridgeId))[0]).bridgeId;
}

function waitForPhase1State() {
	return new Promise((resolve, reject) => {
		let offReady = null;
		let offError = null;
		const cleanup = () => {
			offReady?.();
			offError?.();
		};
		offReady = gameEvents.on(EVENTS.GAME_READY, ({ phase }) => {
			if (phase !== 'phase1-scene') return;
			const state = window.__WESTEROS_RUN200_RUNTIME_STATE__;
			if (!state) {
				cleanup();
				reject(new Error('Run200 scene-state proxy did not capture the live runtime state'));
				return;
			}
			cleanup();
			resolve(state);
		});
		offError = gameEvents.on(EVENTS.GAME_ERROR, ({ error }) => {
			cleanup();
			reject(error instanceof Error ? error : new Error(String(error)));
		});
	});
}

export async function bootCanonicalDeveloperSession() {
	let gate = null;
	let integration = null;
	let bridgeId = null;
	let startupMode = 'canonical-requested';
	let activationError = null;
	let rollbackCount = 0;
	let activationCount = 0;
	const requestedBeforeInit = true;

	const disposeCanonicalOwner = () => {
		gate?.dispose();
		gate = null;
		integration = null;
	};
	window.addEventListener('pagehide', disposeCanonicalOwner, { once: true });

	const phase1State = waitForPhase1State();
	await initGame3D();
	const state = await phase1State;

	const activate = () => {
		if (gate && gate.getMode() === 'canonical') return gate.getMode();
		integration = createCurrentRuntimeIntegrationShadow({ state, profile: RUN200_CANONICAL_STARTUP_POLICY.profile });
		gate = createCurrentTickOwnershipShadow({ state, integration });
		bridgeId = chooseBridgeId();
		gate.activateCanonicalAtBridge(bridgeId);
		activationCount += 1;
		startupMode = 'canonical';
		activationError = null;
		return gate.getMode();
	};

	const rollbackToCurrent = () => {
		if (!gate || gate.getMode() !== 'canonical') return null;
		const result = gate.rollbackToCurrent();
		rollbackCount += 1;
		startupMode = 'current-rollback';
		return result;
	};

	const reactivateCanonical = () => {
		if (!gate) return activate();
		if (gate.getMode() === 'canonical') return gate.getMode();
		gate.dispose();
		gate = null;
		integration = null;
		return activate();
	};

	try {
		activate();
	} catch (error) {
		activationError = String(error?.stack || error);
		startupMode = 'current-fallback';
		try { gate?.dispose(); } catch (disposeError) { activationError += `\nDispose: ${String(disposeError?.stack || disposeError)}`; }
		gate = null;
		integration = null;
		console.info('[Run200] canonical developer activation unavailable; current runtime retained.');
	}

	const api = Object.freeze({
		version: RUN200_CANONICAL_STARTUP_POLICY.key,
		requestedBeforeInit,
		getState: () => state,
		getMode: () => gate?.getMode() || startupMode,
		getBridgeId: () => bridgeId,
		getActivationError: () => activationError,
		getFreezeStats: () => gate?.getFreezeStats() || Object.freeze({}),
		getTransitions: () => gate?.getTransitions() || Object.freeze([]),
		getCounts: () => Object.freeze({ activationCount, rollbackCount }),
		rollbackToCurrent,
		reactivateCanonical,
		dispose: disposeCanonicalOwner,
	});
	window.__WESTEROS_CANONICAL_DEV__ = api;
	return api;
}
