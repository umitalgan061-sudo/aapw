/**
 * Run200 opt-in developer startup composition for the canonical replacement path.
 *
 * This module is intentionally absent from the default game3d import graph. A developer/preflight
 * harness must provide the already-created current runtime state plus an explicit canonical bridge
 * id; no owner/product choice is inferred here. Activation composes the proven Run196 current-
 * runtime ownership transaction with Run197's reversible real-tick freeze and immediately enters
 * canonical mode. Rollback/dispose always return ownership to the unchanged current runtime.
 * @module world/worldReferenceCanonicalDeveloperStartup
 */
import { buildClippedBridgeOwnershipTargets } from './worldReferenceClippedWindowOwnershipShadow.js';
import { createCurrentRuntimeIntegrationShadow } from './worldReferenceCurrentRuntimeIntegrationShadow.js';
import { createCurrentTickOwnershipShadow } from './worldReferenceCurrentTickOwnershipShadow.js';

export const CANONICAL_DEVELOPER_STARTUP_POLICY = Object.freeze({
	key: 'run200-canonical-developer-startup-v1',
	modeCurrent: 'current',
	modeCanonical: 'canonical',
});

function requireBridgeId(bridgeId) {
	if (typeof bridgeId !== 'string' || bridgeId.length === 0) {
		throw new TypeError('bridgeId must be an explicit non-empty string');
	}
	return bridgeId;
}

/**
 * Starts an explicit developer-only canonical ownership session against a live current runtime.
 * The caller chooses the bridge id; this helper never guesses an owner-facing migration policy.
 */
export function createCanonicalDeveloperStartup({ state, profile = 'mobile', bridgeId } = {}) {
	const requestedBridgeId = requireBridgeId(bridgeId);
	const targets = buildClippedBridgeOwnershipTargets();
	const bridgeTarget = targets.find((entry) => entry.bridgeId === requestedBridgeId);
	if (!bridgeTarget) throw new Error(`canonical bridge target not found: ${requestedBridgeId}`);

	const integration = createCurrentRuntimeIntegrationShadow({ state, profile });
	const gate = createCurrentTickOwnershipShadow({ state, integration });
	let disposed = false;
	let activation = null;
	try {
		activation = gate.activateCanonicalAtBridge(requestedBridgeId);
	} catch (error) {
		gate.dispose();
		throw error;
	}

	function assertUsable() {
		if (disposed) throw new Error('canonical developer startup is disposed');
	}

	function rollbackToCurrent() {
		assertUsable();
		return gate.rollbackToCurrent();
	}

	function activateCanonical() {
		assertUsable();
		if (gate.getMode() === CANONICAL_DEVELOPER_STARTUP_POLICY.modeCanonical) return activation;
		activation = gate.activateCanonicalAtBridge(requestedBridgeId);
		return activation;
	}

	function dispose() {
		if (disposed) return;
		gate.dispose();
		disposed = true;
	}

	return Object.freeze({
		version: CANONICAL_DEVELOPER_STARTUP_POLICY.key,
		profile,
		bridgeTarget,
		activateCanonical,
		rollbackToCurrent,
		getMode: () => gate.getMode(),
		getFreezeStats: () => gate.getFreezeStats(),
		getTransitions: () => gate.getTransitions(),
		getActivation: () => activation,
		dispose,
		isDisposed: () => disposed,
	});
}
