/**
 * In-memory runtime telemetry.
 *
 * This is deliberately not an analytics uploader. It provides a bounded local event journal so the
 * game can explain performance and lifecycle decisions to a debug panel, test harness or future
 * explicitly-consented diagnostics sink without introducing network traffic or persistent tracking.
 *
 * Values are normalized to a narrow JSON-safe vocabulary. URLs, free-form payloads, object graphs and
 * player-entered strings are never retained by default. A stable sequence makes replay/debug output
 * deterministic when callers supply their own timestamps.
 */

const LEVELS = Object.freeze(['debug', 'info', 'warn', 'error']);
const DEFAULT_LIMIT = 256;
const MAX_NAME_LENGTH = 80;
const MAX_STRING_LENGTH = 160;
const MAX_FIELDS = 24;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function truncateString(value) {
	return typeof value === 'string' ? value.slice(0, MAX_STRING_LENGTH) : null;
}

function primitive(value) {
	if (typeof value === 'boolean' || typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string') return truncateString(value);
	if (value === null) return null;
	return undefined;
}

function sanitizeFields(fields) {
	if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return Object.freeze({});
	const output = {};
	for (const key of Object.keys(fields).slice(0, MAX_FIELDS)) {
		const safeKey = String(key).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 48);
		const value = primitive(fields[key]);
		if (value !== undefined) output[safeKey] = value;
	}
	return Object.freeze(output);
}

function freeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
}

function stableFieldString(fields) {
	return Object.keys(fields).sort().map((key) => `${key}=${String(fields[key])}`).join('|');
}

export class RuntimeTelemetry {
	constructor({ limit = DEFAULT_LIMIT, clock = () => 0, sessionId = 'local' } = {}) {
		this.limit = clamp(Math.round(Number.isFinite(limit) ? limit : DEFAULT_LIMIT), 32, 2048);
		this.clock = typeof clock === 'function' ? clock : () => 0;
		this.sessionId = truncateString(sessionId) ?? 'local';
		this.entries = [];
		this.sequence = 0;
		this.counters = new Map();
		this.disposed = false;
	}

	emit(level, name, fields = {}, timestamp = this.clock()) {
		if (this.disposed || !LEVELS.includes(level)) return null;
		const safeName = String(name ?? 'event').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, MAX_NAME_LENGTH) || 'event';
		const safeFields = sanitizeFields(fields);
		const entry = freeze({ sequence: ++this.sequence, timestamp: Number.isFinite(timestamp) ? timestamp : 0, level, name: safeName, fields: safeFields });
		this.entries = [...this.entries.slice(-(this.limit - 1)), entry];
		const counterKey = `${level}:${safeName}`;
		this.counters.set(counterKey, (this.counters.get(counterKey) ?? 0) + 1);
		return entry;
	}

	debug(name, fields, timestamp) { return this.emit('debug', name, fields, timestamp); }
	info(name, fields, timestamp) { return this.emit('info', name, fields, timestamp); }
	warn(name, fields, timestamp) { return this.emit('warn', name, fields, timestamp); }
	error(name, fields, timestamp) { return this.emit('error', name, fields, timestamp); }

	recent(limit = 32) {
		const count = clamp(Math.round(Number.isFinite(limit) ? limit : 32), 1, this.limit);
		return this.entries.slice(-count);
	}

	count(name) {
		if (typeof name !== 'string') return 0;
		return [...this.counters.entries()].filter(([key]) => key.endsWith(`:${name}`)).reduce((sum, [, value]) => sum + value, 0);
	}

	summarize() {
		const levels = Object.fromEntries(LEVELS.map((level) => [level, 0]));
		for (const entry of this.entries) levels[entry.level] += 1;
		const recentErrors = this.entries.filter((entry) => entry.level === 'error').slice(-5).map((entry) => entry.name);
		return freeze({ version: 1, sessionId: this.sessionId, retained: this.entries.length, sequence: this.sequence, levels, recentErrors });
	}

	digest() {
		const serialized = this.entries.map((entry) => `${entry.sequence}:${entry.timestamp}:${entry.level}:${entry.name}:${stableFieldString(entry.fields)}`).join('\n');
		let hash = 2166136261;
		for (let i = 0; i < serialized.length; i += 1) {
			hash ^= serialized.charCodeAt(i);
			hash = Math.imul(hash, 16777619) >>> 0;
		}
		return hash.toString(16).padStart(8, '0');
	}

	clear() {
		if (this.disposed) return;
		this.entries = [];
		this.counters.clear();
		this.sequence += 1;
	}

	dispose() {
		this.disposed = true;
		this.entries = [];
		this.counters.clear();
	}

	get isDisposed() { return this.disposed; }
}

export function createRuntimeTelemetry(options) { return new RuntimeTelemetry(options); }
export function telemetryLevels() { return LEVELS.slice(); }
