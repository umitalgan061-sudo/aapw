/**
 * Run200 deterministic, opt-in startup source-selection policy.
 *
 * This module is intentionally not imported by the default player runtime. It exists so a future
 * developer-only canonical boot entry can choose its source-of-truth without guessing about
 * fallback or offline behavior. The decision is pure: same inputs always yield the same result,
 * no clock/random/network/global browser state is consulted, and current runtime remains the
 * conservative fallback whenever canonical readiness is incomplete.
 * @module world/worldReferenceCanonicalStartupPolicy
 */

export const CANONICAL_STARTUP_POLICY = Object.freeze({
	key: 'run200-canonical-startup-policy-v1',
	queryParam: 'worldSource',
	canonicalValue: 'canonical',
	modeCurrent: 'current',
	modeCanonical: 'canonical',
});

function readRequestedSource(search) {
	const params = new URLSearchParams(typeof search === 'string' ? search : '');
	return params.get(CANONICAL_STARTUP_POLICY.queryParam);
}

/**
 * Selects the startup world source for an explicit developer boot path.
 *
 * Canonical mode is allowed only when all of these are true:
 * 1) the request explicitly opts in with `?worldSource=canonical`;
 * 2) canonical runtime prerequisites are ready;
 * 3) if booting offline, the canonical prerequisite set is confirmed cached.
 *
 * Any failed prerequisite deterministically falls back to current mode. This function never
 * throws for a missing/unknown query value because default/current startup must remain safe.
 *
 * @param {object} input
 * @param {string} [input.search=''] URL search string from the developer-only entry point.
 * @param {boolean} [input.canonicalReady=false] Whether canonical boot prerequisites are usable.
 * @param {boolean} [input.offline=false] Whether this boot is intentionally exercising offline mode.
 * @param {boolean} [input.cachedCanonicalReady=false] Whether canonical prerequisites are cached.
 * @returns {{mode:'current'|'canonical', explicitOptIn:boolean, fallback:boolean, reason:string}}
 */
export function decideCanonicalStartup({
	search = '',
	canonicalReady = false,
	offline = false,
	cachedCanonicalReady = false,
} = {}) {
	const requestedSource = readRequestedSource(search);
	const explicitOptIn = requestedSource === CANONICAL_STARTUP_POLICY.canonicalValue;

	if (!explicitOptIn) {
		return Object.freeze({
			mode: CANONICAL_STARTUP_POLICY.modeCurrent,
			explicitOptIn: false,
			fallback: false,
			reason: requestedSource ? 'unknown-source-request' : 'default-current',
		});
	}

	if (!canonicalReady) {
		return Object.freeze({
			mode: CANONICAL_STARTUP_POLICY.modeCurrent,
			explicitOptIn: true,
			fallback: true,
			reason: 'canonical-not-ready',
		});
	}

	if (offline && !cachedCanonicalReady) {
		return Object.freeze({
			mode: CANONICAL_STARTUP_POLICY.modeCurrent,
			explicitOptIn: true,
			fallback: true,
			reason: 'offline-canonical-cache-not-ready',
		});
	}

	return Object.freeze({
		mode: CANONICAL_STARTUP_POLICY.modeCanonical,
		explicitOptIn: true,
		fallback: false,
		reason: offline ? 'canonical-offline-cache-ready' : 'canonical-ready',
	});
}
