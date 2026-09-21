/**
 * Machine-readable audio QA report helpers.
 *
 * Aggregates policy-level checks into one stable report that can be consumed by CI or future support
 * tooling. It does not run browser playback; it reports contract-level health and explicitly distinguishes
 * unsupported Web Audio from a failed policy. This prevents headless CI from pretending to have validated
 * device-specific audio drivers.
 */

const SEVERITIES = Object.freeze(['info', 'warn', 'error']);
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };

export function createAudioQaCheck(name, passed, severity = 'error', details = {}) {
	const level = SEVERITIES.includes(severity) ? severity : 'error';
	return freeze({ version: 1, name: String(name).slice(0, 96), passed: passed === true, severity: level, details: sanitize(details) });
}

function sanitize(details) {
	if (!details || typeof details !== 'object') return {};
	const output = {};
	for (const key of Object.keys(details).slice(0, 16)) {
		const value = details[key];
		if (typeof value === 'string') output[key] = value.slice(0, 128);
		else if (typeof value === 'boolean') output[key] = value;
		else if (typeof value === 'number' && Number.isFinite(value)) output[key] = Number(value.toFixed(5));
	}
	return output;
}

export function createAudioQaReport({ revision = 'unknown', checks = [], environment = 'headless', supported = true } = {}) {
	const normalized = checks.map((check) => createAudioQaCheck(check.name, check.passed, check.severity, check.details));
	const errors = normalized.filter((check) => !check.passed && check.severity === 'error').length;
	const warnings = normalized.filter((check) => !check.passed && check.severity === 'warn').length;
	return freeze({ version: 1, revision: String(revision).slice(0, 96), environment: String(environment).slice(0, 48), supported: supported === true, pass: errors === 0, counts: { checks: normalized.length, errors, warnings }, checks: normalized });
}

export function audioQaSummary(report) {
	return freeze({ version: 1, pass: report?.pass === true, supported: report?.supported === true, checks: report?.counts?.checks ?? 0, errors: report?.counts?.errors ?? 0, warnings: report?.counts?.warnings ?? 0 });
}

export function serializeAudioQaReport(report) { return JSON.stringify(report ?? {}); }
