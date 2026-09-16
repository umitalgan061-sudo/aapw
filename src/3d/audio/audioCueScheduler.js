/**
 * Deterministic audio cue scheduler.
 *
 * Event bursts can be more damaging to an audio graph than frame-rate bursts. This scheduler provides
 * bounded one-shot admission with per-cue cooldowns, duplicate suppression, priority ordering and
 * explicit ageing. It does not own timers; the caller advances it from the existing simulation tick.
 */

const DEFAULT_MAX_QUEUE = 64;
const DEFAULT_MAX_HISTORY = 128;
const DEFAULT_COOLDOWNS = Object.freeze({ footstep: 0.08, combat: 0.12, dragon: 0.4, storm: 0.8, ui: 0.03, ambience: 0.25 });
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;

export class AudioCueScheduler {
	constructor({ maxQueue = DEFAULT_MAX_QUEUE, maxHistory = DEFAULT_MAX_HISTORY, cooldowns = DEFAULT_COOLDOWNS } = {}) {
		this.maxQueue = clamp(Math.round(finiteOr(maxQueue, DEFAULT_MAX_QUEUE)), 8, 256);
		this.maxHistory = clamp(Math.round(finiteOr(maxHistory, DEFAULT_MAX_HISTORY)), 16, 512);
		this.cooldowns = { ...DEFAULT_COOLDOWNS, ...(cooldowns ?? {}) };
		this.now = 0;
		this.sequence = 0;
		this.queue = [];
		this.history = [];
		this.lastPlayed = new Map();
		this.disposed = false;
	}

	advance(deltaSeconds = 0.016) {
		if (this.disposed) return this.snapshot();
		this.now += clamp(finiteOr(deltaSeconds, 0), 0, 0.25);
		return this.snapshot();
	}

	enqueue({ id, kind = 'ambience', priority = 30, gain = 0.2, distance = 0, sourceId = null, payload = {} } = {}) {
		if (this.disposed) return false;
		const safeId = String(id ?? `${kind}-${this.sequence + 1}`).slice(0, 96);
		const safeKind = String(kind).slice(0, 48);
		const cooldown = clamp(finiteOr(this.cooldowns[safeKind], 0), 0, 10);
		const previous = this.lastPlayed.get(safeId);
		if (Number.isFinite(previous) && this.now - previous < cooldown) return false;
		if (this.queue.length >= this.maxQueue) {
			const weakest = this.queue.reduce((candidate, item, index) => item.priority < candidate.item.priority ? { item, index } : candidate, { item: this.queue[0], index: 0 });
			if (!weakest.item || priority <= weakest.item.priority) return false;
			this.queue.splice(weakest.index, 1);
		}
		const entry = freeze({ version: 1, sequence: ++this.sequence, id: safeId, kind: safeKind, priority: clamp(Math.round(finiteOr(priority, 30)), 0, 100), gain: clamp(finiteOr(gain, 0.2), 0, 1), distance: Math.max(0, finiteOr(distance, 0)), sourceId: sourceId == null ? null : String(sourceId).slice(0, 96), payload: sanitizePayload(payload) });
		this.queue.push(entry);
		return true;
	}

	dequeue(limit = 8) {
		const count = clamp(Math.round(finiteOr(limit, 8)), 1, this.queue.length || 1);
		this.queue.sort((a, b) => b.priority - a.priority || a.distance - b.distance || a.sequence - b.sequence);
		const selected = this.queue.splice(0, count);
		for (const entry of selected) {
			this.lastPlayed.set(entry.id, this.now);
			this.history = [...this.history.slice(-(this.maxHistory - 1)), freeze({ ...entry, playedAt: this.now })];
		}
		return selected;
	}

	clear() { this.queue = []; this.sequence += 1; }

	stats() {
		return freeze({ queued: this.queue.length, history: this.history.length, cooldownKeys: this.lastPlayed.size, now: Number(this.now.toFixed(4)) });
	}

	snapshot() { return freeze({ version: 1, disposed: this.disposed, sequence: this.sequence, ...this.stats(), queue: this.queue.slice(), history: this.history.slice(-16) }); }
	dispose() { this.disposed = true; this.queue = []; this.history = []; this.lastPlayed.clear(); }
}

function sanitizePayload(payload) {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
	const output = {};
	for (const key of Object.keys(payload).slice(0, 8)) {
		const value = payload[key];
		if (typeof value === 'string') output[key.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 48)] = value.slice(0, 96);
		else if (typeof value === 'number' && Number.isFinite(value)) output[key.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 48)] = Number(value.toFixed(4));
		else if (typeof value === 'boolean') output[key.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 48)] = value;
	}
	return output;
}

export function createAudioCueScheduler(options) { return new AudioCueScheduler(options); }
export function audioCueSchedulerConstants() { return freeze({ defaults: DEFAULT_COOLDOWNS }); }
