/**
 * Dynamic range ducking bus.
 *
 * Audio groups such as dialogue, combat, UI and ambience need predictable precedence. This bus keeps
 * ducking envelopes as scalar policy state. It owns neither gain nodes nor timers; callers advance it
 * using their existing frame delta and apply the returned gains to their own graph nodes.
 */

const GROUPS = Object.freeze(['music', 'ambience', 'weather', 'water', 'npc', 'player', 'combat', 'dialogue', 'ui', 'debug']);
const DEFAULT_PRIORITY = Object.freeze({ music: 20, ambience: 25, weather: 35, water: 40, npc: 55, player: 75, combat: 90, dialogue: 100, ui: 110, debug: 120 });
const DEFAULT_DUCK = Object.freeze({ music: 0.32, ambience: 0.5, weather: 0.62, water: 0.72, npc: 0.78, player: 0.86, combat: 1, dialogue: 1, ui: 1, debug: 1 });
const DEFAULT_ATTACK = 0.05;
const DEFAULT_RELEASE = 0.28;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };

function normalizeGroup(value) { return GROUPS.includes(value) ? value : 'ambience'; }

export class AudioDuckBus {
	constructor({ attackSeconds = DEFAULT_ATTACK, releaseSeconds = DEFAULT_RELEASE, globalDuck = 1 } = {}) {
		this.attackSeconds = clamp(finiteOr(attackSeconds, DEFAULT_ATTACK), 0.01, 2);
		this.releaseSeconds = clamp(finiteOr(releaseSeconds, DEFAULT_RELEASE), 0.01, 4);
		this.globalDuck = clamp(finiteOr(globalDuck, 1), 0, 1);
		this.requests = new Map();
		this.envelopes = new Map(GROUPS.map((group) => [group, 1]));
		this.sequence = 0;
		this.disposed = false;
	}

	request(group, { active = true, priority, amount, attackSeconds, releaseSeconds, id = group } = {}) {
		if (this.disposed) return null;
		const key = String(id).slice(0, 96);
		const safeGroup = normalizeGroup(group);
		const request = freeze({ version: 1, id: key, group: safeGroup, active: active === true, priority: clamp(Math.round(finiteOr(priority, DEFAULT_PRIORITY[safeGroup])), 0, 200), amount: clamp(finiteOr(amount, DEFAULT_DUCK[safeGroup]), 0, 1), attackSeconds: clamp(finiteOr(attackSeconds, this.attackSeconds), 0.01, 2), releaseSeconds: clamp(finiteOr(releaseSeconds, this.releaseSeconds), 0.01, 4) });
		this.requests.set(key, request);
		this.sequence += 1;
		return request;
	}

	clear(id) { const removed = this.requests.delete(String(id)); if (removed) this.sequence += 1; return removed; }

	setGlobalDuck(value) { this.globalDuck = clamp(finiteOr(value, 1), 0, 1); this.sequence += 1; return this.snapshot(); }

	update(deltaSeconds = 0.016) {
		if (this.disposed) return this.snapshot();
		const dt = clamp(finiteOr(deltaSeconds, 0), 0, 0.25);
		const targets = Object.fromEntries(GROUPS.map((group) => [group, 1]));
		for (const request of this.requests.values()) {
			if (!request.active) continue;
			for (const group of GROUPS) if (group !== request.group && request.priority >= DEFAULT_PRIORITY[group]) targets[group] = Math.min(targets[group], request.amount);
		}
		for (const group of GROUPS) {
			const current = this.envelopes.get(group) ?? 1;
			const target = clamp(targets[group] * this.globalDuck, 0, 1);
			const attack = target < current ? this.attackSeconds : this.releaseSeconds;
			const t = clamp(dt / Math.max(attack, 0.001), 0, 1);
			this.envelopes.set(group, current + (target - current) * t);
		}
		this.sequence += 1;
		return this.snapshot();
	}

	gain(group) { return Number((this.envelopes.get(normalizeGroup(group)) ?? 1).toFixed(5)); }

	groupGains() { return Object.fromEntries(GROUPS.map((group) => [group, this.gain(group)])); }

	snapshot() { return freeze({ version: 1, sequence: this.sequence, disposed: this.disposed, globalDuck: Number(this.globalDuck.toFixed(5)), requests: [...this.requests.values()], gains: this.groupGains() }); }
	dispose() { this.disposed = true; this.requests.clear(); }
}

export function createAudioDuckBus(options) { return new AudioDuckBus(options); }
export function audioDuckBusConstants() { return freeze({ groups: GROUPS.slice(), priorities: DEFAULT_PRIORITY, duck: DEFAULT_DUCK }); }
