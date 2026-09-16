/**
 * Versioned runtime policy helpers.
 *
 * Policy snapshots are intentionally versioned so future runtime releases can evolve fields without
 * forcing every debug surface and acceptance script to know every historical shape. Migration is pure,
 * additive and fail-closed: unknown future versions are preserved as opaque records rather than guessed.
 */

const CURRENT_VERSION = 1;
const SUPPORTED_VERSIONS = Object.freeze([1]);
const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};

function asRecord(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

export function normalizeRuntimePolicyVersion(policy) {
	const source = asRecord(policy);
	const version = Number.isInteger(source.version) ? source.version : 0;
	if (SUPPORTED_VERSIONS.includes(version)) return freeze({ ...source, version });
	if (version === 0) return freeze({ ...source, version: CURRENT_VERSION, migratedFromVersion: 0 });
	return freeze({ ...source, version, compatibility: 'opaque-future-version' });
}

export function canConsumeRuntimePolicy(policy) {
	const version = normalizeRuntimePolicyVersion(policy).version;
	return SUPPORTED_VERSIONS.includes(version);
}

export function createRuntimePolicyEnvelope(payload, { schema = 'aapw.runtime-policy', version = CURRENT_VERSION } = {}) {
	return freeze({ schema, version, payload: asRecord(payload) });
}

export function readRuntimePolicyEnvelope(envelope) {
	const source = asRecord(envelope);
	const policy = normalizeRuntimePolicyVersion(source.payload);
	return freeze({ schema: typeof source.schema === 'string' ? source.schema.slice(0, 80) : 'aapw.runtime-policy', version: source.version ?? policy.version, compatible: canConsumeRuntimePolicy(policy), policy });
}

export function runtimePolicyVersionConstants() { return freeze({ current: CURRENT_VERSION, supported: SUPPORTED_VERSIONS.slice() }); }
