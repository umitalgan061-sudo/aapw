/**
 * Run200 deterministic, opt-in startup source-selection policy.
 *
 * This developer-only module is intentionally outside src/3d and is not imported by the default
 * player runtime or current PWA shell. A future opt-in developer entry may consume it once that
 * entry owns its own cache contract. The decision is pure: same inputs always yield the same
 * result, no clock/random/network/global browser state is consulted, and current runtime remains
 * the conservative fallback whenever canonical readiness is incomplete.
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
