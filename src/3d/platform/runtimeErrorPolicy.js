/**
 * Structured runtime error isolation policy.
 *
 * Existing safeMode utilities protect individual update calls. This policy adds a common vocabulary
 * for classifying failures and deciding whether a subsystem should retry, degrade, skip one unit, or
 * stop its optional work. It never throws on classification input and never swallows caller-owned
 * exceptions; callers decide how to apply the returned action.
 */

const SEVERITY = Object.freeze({ INFO: 'info', WARN: 'warn', ERROR: 'error', FATAL: 'fatal' });
const ACTION = Object.freeze({ CONTINUE: 'continue', RETRY: 'retry', DEFER: 'defer', ISOLATE: 'isolate', STOP_OPTIONAL: 'stop-optional', STOP_REQUIRED: 'stop-required' });
const DOMAINS = Object.freeze({ RENDER: 'render', ASSET: 'asset', WORLD: 'world', GAMEPLAY: 'gameplay', INPUT: 'input', PWA: 'pwa', UI: 'ui', UNKNOWN: 'unknown' });

const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function safeString(value, fallback = 'unknown') {
	return typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : fallback;
}

function inferDomain(error, explicit) {
	if (Object.values(DOMAINS).includes(explicit)) return explicit;
	const text = `${error?.name ?? ''} ${error?.message ?? ''}`.toLowerCase();
	if (/texture|model|fbx|glb|asset|loader/.test(text)) return DOMAINS.ASSET;
	if (/webgl|shader|renderer|context lost/.test(text)) return DOMAINS.RENDER;
	if (/terrain|road|river|water|geology|settlement/.test(text)) return DOMAINS.WORLD;
	if (/input|pointer|keyboard|gamepad|touch/.test(text)) return DOMAINS.INPUT;
	if (/service.?worker|cache|offline/.test(text)) return DOMAINS.PWA;
	if (/dialogue|health|combat|player|npc|animal|dragon/.test(text)) return DOMAINS.GAMEPLAY;
	return DOMAINS.UNKNOWN;
}

function defaultAction(severity, { optional = true, retryable = false } = {}) {
	if (severity === SEVERITY.FATAL) return optional ? ACTION.STOP_OPTIONAL : ACTION.STOP_REQUIRED;
	if (retryable && severity === SEVERITY.ERROR) return ACTION.RETRY;
	if (severity === SEVERITY.ERROR) return optional ? ACTION.ISOLATE : ACTION.STOP_REQUIRED;
	if (severity === SEVERITY.WARN) return ACTION.DEFER;
	return ACTION.CONTINUE;
}

export function classifyRuntimeError(error, options = {}) {
	const severity = Object.values(SEVERITY).includes(options.severity) ? options.severity : (options.fatal ? SEVERITY.FATAL : error ? SEVERITY.ERROR : SEVERITY.INFO);
	const domain = inferDomain(error, options.domain);
	const optional = options.optional !== false;
	const retryable = options.retryable === true;
	const action = Object.values(ACTION).includes(options.action) ? options.action : defaultAction(severity, { optional, retryable });
	const attempts = clamp(Math.round(Number.isFinite(options.attempts) ? options.attempts : 0), 0, 20);
	const code = safeString(options.code, `${domain}-${severity}`);
	return freeze({
		version: 1,
		severity,
		domain,
		optional,
		retryable,
		action: retryable && attempts >= 3 && action === ACTION.RETRY ? ACTION.DEFER : action,
		attempts,
		code,
		message: safeString(error?.message, 'runtime failure').slice(0, 160),
	});
}

export function shouldContinueAfterRuntimeError(decision) {
	return [ACTION.CONTINUE, ACTION.RETRY, ACTION.DEFER, ACTION.ISOLATE].includes(decision?.action);
}

export function createErrorBudget({ maxErrors = 8, windowEvents = 120 } = {}) {
	const limit = clamp(Math.round(Number.isFinite(maxErrors) ? maxErrors : 8), 1, 100);
	const windowSize = clamp(Math.round(Number.isFinite(windowEvents) ? windowEvents : 120), 16, 1000);
	let events = [];
	return {
		record(decision) {
			const entry = freeze({ sequence: (events.at(-1)?.sequence ?? 0) + 1, decision });
			events = [...events.slice(-(windowSize - 1)), entry];
			return events.filter((item) => item.decision?.severity === SEVERITY.ERROR || item.decision?.severity === SEVERITY.FATAL).length <= limit;
		},
		count() { return events.length; },
		snapshot() { return freeze({ version: 1, limit, windowSize, retained: events.length, errors: events.filter((item) => item.decision?.severity !== SEVERITY.INFO).length }); },
		clear() { events = []; },
	};
}

export function runtimeErrorPolicyConstants() { return freeze({ severity: SEVERITY, action: ACTION, domains: DOMAINS }); }
