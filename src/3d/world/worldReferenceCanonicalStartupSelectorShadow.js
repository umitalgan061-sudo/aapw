/**
 * Run 200 shadow-only startup source selector for the canonical migration path.
 *
 * This module is deliberately not imported by the default game3d runtime. A future opt-in
 * developer entry point can resolve its requested world source before starting simulation, then
 * hand the real createScene() state to this selector. Canonical activation remains reversible;
 * an invalid/failed canonical request falls back to the untouched current runtime instead of
 * guessing a replacement policy.
 * @module world/worldReferenceCanonicalStartupSelectorShadow
 */

import { createCurrentRuntimeIntegrationShadow } from './worldReferenceCurrentRuntimeIntegrationShadow.js';

export const CANONICAL_STARTUP_SELECTOR_SHADOW_POLICY = Object.freeze({
	key: 'run200-canonical-startup-selector-shadow-v1',
	current: 'current',
	canonical: 'canonical',
	queryKey: 'worldSource',
	canonicalQueryValue: 'canonical-dev',
});

export function resolveCanonicalStartupSourceShadow(search = '') {
	const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
	return params.get(CANONICAL_STARTUP_SELECTOR_SHADOW_POLICY.queryKey)
		=== CANONICAL_STARTUP_SELECTOR_SHADOW_POLICY.canonicalQueryValue
		? CANONICAL_STARTUP_SELECTOR_SHADOW_POLICY.canonical
		: CANONICAL_STARTUP_SELECTOR_SHADOW_POLICY.current;
}

export function createCanonicalStartupSelectorShadow({
	state,
	search = '',
	bridgeId,
	profile = 'mobile',
} = {}) {
	const requestedSource = resolveCanonicalStartupSourceShadow(search);
	const integration = createCurrentRuntimeIntegrationShadow({ state, profile });
	let activeSource = CANONICAL_STARTUP_SELECTOR_SHADOW_POLICY.current;
	let activation = null;
	let fallbackReason = null;
	let disposed = false;

	if (requestedSource === CANONICAL_STARTUP_SELECTOR_SHADOW_POLICY.canonical) {
		try {
			activation = integration.activateCanonicalAtBridge(bridgeId);
			activeSource = CANONICAL_STARTUP_SELECTOR_SHADOW_POLICY.canonical;
		} catch (error) {
			fallbackReason = String(error?.message || error);
			activeSource = CANONICAL_STARTUP_SELECTOR_SHADOW_POLICY.current;
		}
	}

	function assertUsable() {
		if (disposed) throw new Error('canonical startup selector shadow is disposed');
	}

	function rollbackToCurrent() {
		assertUsable();
		const result = integration.rollbackToCurrent();
		activeSource = CANONICAL_STARTUP_SELECTOR_SHADOW_POLICY.current;
		return result;
	}

	function dispose() {
		if (disposed) return;
		integration.dispose();
		disposed = true;
	}

	return Object.freeze({
		version: CANONICAL_STARTUP_SELECTOR_SHADOW_POLICY.key,
		requestedSource,
		getActiveSource: () => activeSource,
		activation,
		fallbackReason,
		integration,
		rollbackToCurrent,
		dispose,
		isDisposed: () => disposed,
	});
}
