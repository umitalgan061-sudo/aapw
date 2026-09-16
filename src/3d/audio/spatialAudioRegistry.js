/**
 * Bounded spatial audio source registry.
 *
 * Keeps source metadata separate from the Web Audio graph. A future audio director may translate an
 * admitted source into PannerNode/GainNode instances, while this registry remains fully usable in a
 * headless test. It applies deterministic priority + distance admission, supports source virtualization,
 * and keeps the registry bounded so an accidental entity burst cannot allocate unbounded voices.
 */

const DEFAULT_MAX_SOURCES = 48;
const DEFAULT_MAX_POSITIONAL = 28;
const MAX_ID_LENGTH = 96;
const SOURCE_STATES = Object.freeze({ REGISTERED: 'registered', ACTIVE: 'active', VIRTUAL: 'virtual', STOPPED: 'stopped' });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
function freeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; }
function normalizeId(value, fallbackSequence) { return String(value ?? `source-${fallbackSequence}`).replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, MAX_ID_LENGTH); }
function normalizePosition(position) { return { x: finiteOr(position?.x, 0), y: finiteOr(position?.y, 0), z: finiteOr(position?.z, 0) }; }
function normalizeVelocity(velocity) { return { x: finiteOr(velocity?.x, 0), y: finiteOr(velocity?.y, 0), z: finiteOr(velocity?.z, 0) }; }
function sourceScore(source, listenerPosition) { const p = source.position; const l = listenerPosition ?? { x: 0, y: 0, z: 0 }; const distance = Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z); return { distance, score: source.priority * 1000 - distance * 4 - source.voiceCost * 20 }; }

export class SpatialAudioRegistry {
	constructor({ maxSources = DEFAULT_MAX_SOURCES, maxPositionalSources = DEFAULT_MAX_POSITIONAL, maxDistance = 120 } = {}) {
		this.maxSources = clamp(Math.round(finiteOr(maxSources, DEFAULT_MAX_SOURCES)), 1, 128);
		this.maxPositionalSources = clamp(Math.round(finiteOr(maxPositionalSources, DEFAULT_MAX_POSITIONAL)), 0, this.maxSources);
		this.maxDistance = clamp(finiteOr(maxDistance, 120), 10, 500);
		this.sources = new Map();
		this.sequence = 0;
		this.disposed = false;
	}

	register(input = {}) {
		if (this.disposed) return null;
		const id = normalizeId(input.id, this.sequence + 1);
		if (this.sources.has(id)) return this.update(id, input);
		if (this.sources.size >= this.maxSources) return null;
		const source = freeze({ version: 1, id, sequence: ++this.sequence, class: typeof input.class === 'string' ? input.class.slice(0, 48) : 'ambience', priority: clamp(Math.round(finiteOr(input.priority, 30)), 0, 100), voiceCost: clamp(finiteOr(input.voiceCost, 1), 0.25, 4), position: normalizePosition(input.position), velocity: normalizeVelocity(input.velocity), gain: clamp(finiteOr(input.gain, 1), 0, 1), maxDistance: clamp(finiteOr(input.maxDistance, this.maxDistance), 1, this.maxDistance), positional: input.positional !== false, loop: input.loop !== false, state: SOURCE_STATES.REGISTERED, timestamp: finiteOr(input.timestamp, 0) });
		this.sources.set(id, source);
		return source;
	}

	update(id, patch = {}) {
		const key = normalizeId(id, this.sequence + 1);
		const current = this.sources.get(key);
		if (!current || this.disposed) return null;
		const next = freeze({ ...current, ...patch, position: patch.position ? normalizePosition(patch.position) : current.position, velocity: patch.velocity ? normalizeVelocity(patch.velocity) : current.velocity, priority: patch.priority === undefined ? current.priority : clamp(Math.round(finiteOr(patch.priority, current.priority)), 0, 100), gain: patch.gain === undefined ? current.gain : clamp(finiteOr(patch.gain, current.gain), 0, 1), sequence: ++this.sequence });
		this.sources.set(key, next);
		return next;
	}

	setState(id, state) { if (!Object.values(SOURCE_STATES).includes(state)) return null; return this.update(id, { state }); }
	unregister(id) { return this.sources.delete(normalizeId(id, this.sequence + 1)); }
	get(id) { return this.sources.get(normalizeId(id, this.sequence + 1)) ?? null; }

	selectAdmissions({ listenerPosition = { x: 0, y: 0, z: 0 }, maxSources = this.maxSources, maxPositionalSources = this.maxPositionalSources } = {}) {
		const sourceLimit = clamp(Math.round(finiteOr(maxSources, this.maxSources)), 0, this.maxSources);
		const positionalLimit = clamp(Math.round(finiteOr(maxPositionalSources, this.maxPositionalSources)), 0, sourceLimit);
		const ranked = [...this.sources.values()].filter((source) => source.state !== SOURCE_STATES.STOPPED).map((source) => ({ source, ...sourceScore(source, listenerPosition) })).filter((item) => item.distance <= item.source.maxDistance).sort((a, b) => b.score - a.score || String(a.source.id).localeCompare(String(b.source.id)));
		let positionalLeft = positionalLimit;
		let voicesLeft = sourceLimit;
		const admitted = [];
		for (const item of ranked) {
			if (voicesLeft <= 0 || item.source.voiceCost > voicesLeft) continue;
			if (item.source.positional && positionalLeft <= 0) continue;
			admitted.push(freeze({ ...item.source, distance: Number(item.distance.toFixed(4)), state: SOURCE_STATES.ACTIVE }));
			voicesLeft -= item.source.voiceCost;
			if (item.source.positional) positionalLeft -= 1;
		}
		const admittedIds = new Set(admitted.map((item) => item.id));
		for (const source of this.sources.values()) {
			if (source.state === SOURCE_STATES.STOPPED) continue;
			const state = admittedIds.has(source.id) ? SOURCE_STATES.ACTIVE : SOURCE_STATES.VIRTUAL;
			if (source.state !== state) this.sources.set(source.id, freeze({ ...source, state, sequence: ++this.sequence }));
		}
		return freeze({ version: 1, requested: ranked.length, admitted: admitted.length, virtualized: Math.max(0, ranked.length - admitted.length), remainingVoices: Number(Math.max(0, voicesLeft).toFixed(3)), remainingPositional: positionalLeft, sources: admitted });
	}

	markStopped(id) { return this.setState(id, SOURCE_STATES.STOPPED); }
	clearVirtualized() { for (const source of this.sources.values()) if (source.state === SOURCE_STATES.VIRTUAL) this.sources.set(source.id, freeze({ ...source, state: SOURCE_STATES.REGISTERED, sequence: ++this.sequence })); }
	snapshot() { return freeze({ version: 1, disposed: this.disposed, sequence: this.sequence, maxSources: this.maxSources, maxPositionalSources: this.maxPositionalSources, sourceCount: this.sources.size, sources: [...this.sources.values()].map((source) => ({ ...source, position: { ...source.position }, velocity: { ...source.velocity } })) }); }
	dispose() { this.disposed = true; this.sources.clear(); }
}

export function createSpatialAudioRegistry(options) { return new SpatialAudioRegistry(options); }
export function spatialAudioRegistryConstants() { return freeze({ states: SOURCE_STATES, defaultMaxSources: DEFAULT_MAX_SOURCES, defaultMaxPositionalSources: DEFAULT_MAX_POSITIONAL }); }
