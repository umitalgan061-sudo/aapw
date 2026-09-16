/**
 * Bounded diagnostics channel for future debug surfaces.
 *
 * Stores only typed, redacted diagnostic records and exposes a small publish/consume contract. There is
 * no network transport, DOM coupling or persistence. The channel can be fed from runtime telemetry or
 * health snapshots without introducing another global event system.
 */

const TYPES = Object.freeze(['health', 'quality', 'performance', 'offline', 'asset', 'lifecycle']);
const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class RuntimeDiagnosticsChannel {
	constructor({ limit = 128 } = {}) {
		this.limit = clamp(Math.round(Number.isFinite(limit) ? limit : 128), 16, 512);
		this.records = [];
		this.sequence = 0;
	}

	publish(type, payload = {}) {
		if (!TYPES.includes(type)) return null;
		const safe = {};
		for (const key of Object.keys(payload).slice(0, 12)) {
			const value = payload[key];
			if (typeof value === 'string') safe[key] = value.slice(0, 96);
			else if (typeof value === 'number' && Number.isFinite(value)) safe[key] = Number(value.toFixed(4));
			else if (typeof value === 'boolean') safe[key] = value;
		}
		const record = freeze({ version: 1, sequence: ++this.sequence, type, payload: safe });
		this.records = [...this.records.slice(-(this.limit - 1)), record];
		return record;
	}

	recent(limit = 16) { return this.records.slice(-clamp(Math.round(limit), 1, this.limit)); }
	clear() { this.records = []; this.sequence += 1; }
	snapshot() { return freeze({ version: 1, sequence: this.sequence, retained: this.records.length, types: TYPES.slice(), recent: this.recent() }); }
}

export function createRuntimeDiagnosticsChannel(options) { return new RuntimeDiagnosticsChannel(options); }
export function runtimeDiagnosticsTypes() { return TYPES.slice(); }
