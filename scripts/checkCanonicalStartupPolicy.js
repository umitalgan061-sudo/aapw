#!/usr/bin/env node
/** Run200 regression gate for the deterministic developer-only canonical startup policy. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const POLICY_PATH = path.join(ROOT, 'src', '3d', 'world', 'worldReferenceCanonicalStartupPolicy.js');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function loadPolicy() {
	const source = fs.readFileSync(POLICY_PATH, 'utf8');
	assert(!source.includes('Math.random'), 'startup policy must not use Math.random');
	assert(!source.includes('Date.now'), 'startup policy must not use Date.now');
	assert(!source.includes('fetch('), 'startup policy must not perform network I/O');
	assert(!source.includes('localStorage'), 'startup policy must not consult ambient persisted state');
	const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
	return import(dataUrl);
}

async function main() {
	const { CANONICAL_STARTUP_POLICY, decideCanonicalStartup } = await loadPolicy();
	assert(Object.isFrozen(CANONICAL_STARTUP_POLICY), 'policy metadata must be frozen');
	assert(CANONICAL_STARTUP_POLICY.queryParam === 'worldSource', 'unexpected opt-in query parameter');

	const cases = [
		[{ search: '', canonicalReady: true }, { mode: 'current', explicitOptIn: false, fallback: false, reason: 'default-current' }],
		[{ search: '?worldSource=current', canonicalReady: true }, { mode: 'current', explicitOptIn: false, fallback: false, reason: 'unknown-source-request' }],
		[{ search: '?worldSource=other', canonicalReady: true }, { mode: 'current', explicitOptIn: false, fallback: false, reason: 'unknown-source-request' }],
		[{ search: '?worldSource=canonical', canonicalReady: false }, { mode: 'current', explicitOptIn: true, fallback: true, reason: 'canonical-not-ready' }],
		[{ search: '?worldSource=canonical', canonicalReady: true }, { mode: 'canonical', explicitOptIn: true, fallback: false, reason: 'canonical-ready' }],
		[{ search: '?x=1&worldSource=canonical&y=2', canonicalReady: true }, { mode: 'canonical', explicitOptIn: true, fallback: false, reason: 'canonical-ready' }],
		[{ search: '?worldSource=canonical', canonicalReady: true, offline: true, cachedCanonicalReady: false }, { mode: 'current', explicitOptIn: true, fallback: true, reason: 'offline-canonical-cache-not-ready' }],
		[{ search: '?worldSource=canonical', canonicalReady: true, offline: true, cachedCanonicalReady: true }, { mode: 'canonical', explicitOptIn: true, fallback: false, reason: 'canonical-offline-cache-ready' }],
	];

	for (const [input, expected] of cases) {
		const result = decideCanonicalStartup(input);
		assert(Object.isFrozen(result), `decision must be frozen for ${JSON.stringify(input)}`);
		assert(JSON.stringify(result) === JSON.stringify(expected), `decision mismatch for ${JSON.stringify(input)}: ${JSON.stringify(result)}`);
		for (let i = 0; i < 100; i += 1) {
			assert(JSON.stringify(decideCanonicalStartup(input)) === JSON.stringify(expected), `non-deterministic decision for ${JSON.stringify(input)}`);
		}
	}

	console.log(`[checkCanonicalStartupPolicy] PASS: ${cases.length} startup/fallback/offline cases deterministic; default remains current.`);
}

main().catch((error) => {
	console.error('[checkCanonicalStartupPolicy] FAIL:', error?.stack || error);
	process.exitCode = 1;
});
