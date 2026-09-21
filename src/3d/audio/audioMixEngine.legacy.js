/**
 * Bounded audio mix engine.
 *
 * Applies policy-level gains to a set of abstract channels without requiring Three.js or AudioNode
 * instances. This allows tests and debug tooling to inspect the exact mix before a graph adapter applies
 * it. It combines ducking, accessibility, source occlusion and master volume while preserving critical
 * channels under heavy ambience.
 */

const CHANNELS = Object.freeze(['music', 'ambience', 'weather', 'water', 'npc', 'player', 'combat', 'dialogue', 'ui', 'debug']);
const DEFAULT_BASE = Object.freeze({ music: 0.32, ambience: 0.28, weather: 0.24, water: 0.2, npc: 0.24, player: 0.34, combat: 0.42, dialogue: 0.52, ui: 0.35, debug: 0.08 });
const CRITICAL = new Set(['dialogue', 'ui', 'combat', 'player']);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };

function safeChannel(channel) { return CHANNELS.includes(channel) ? channel : 'ambience'; }

export class AudioMixEngine {
	constructor({ masterVolume = 1, bases = DEFAULT_BASE, duckGains = {}, maxOutput = 1 } = {}) {
		this.masterVolume = clamp(finiteOr(masterVolume, 1), 0, 1);
		this.maxOutput = clamp(finiteOr(maxOutput, 1), 0.1, 1);
		this.bases = { ...DEFAULT_BASE, ...(bases ?? {}) };
		this.duckGains = { ...Object.fromEntries(CHANNELS.map((channel) => [channel, 1])), ...(duckGains ?? {}) };
		this.overrides = new Map();
		this.sequence = 0;
	}

	setMasterVolume(value) { this.masterVolume = clamp(finiteOr(value, this.masterVolume), 0, 1); this.sequence += 1; return this.masterVolume; }
	setDuck(channel, gain) { const key = safeChannel(channel); this.duckGains[key] = clamp(finiteOr(gain, 1), 0, 1); this.sequence += 1; return this.duckGains[key]; }
	setBase(channel, gain) { const key = safeChannel(channel); this.bases[key] = clamp(finiteOr(gain, DEFAULT_BASE[key]), 0, 1); this.sequence += 1; return this.bases[key]; }
	setOverride(channel, gain) { const key = safeChannel(channel); this.overrides.set(key, clamp(finiteOr(gain, 1), 0, 2)); this.sequence += 1; return this.overrides.get(key); }
	clearOverride(channel) { const removed = this.overrides.delete(safeChannel(channel)); if (removed) this.sequence += 1; return removed; }

	compute({ channel, sourceGain = 1, occlusionGain = 1, accessibilityGain = 1, environmentGain = 1, priority = 30 } = {}) {
		const key = safeChannel(channel);
		const base = clamp(finiteOr(this.bases[key], DEFAULT_BASE[key]), 0, 1);
		const duck = clamp(finiteOr(this.duckGains[key], 1), 0, 1);
		const override = clamp(finiteOr(this.overrides.get(key), 1), 0, 2);
		const source = clamp(finiteOr(sourceGain, 1), 0, 1);
		const occlusion = clamp(finiteOr(occlusionGain, 1), 0, 1);
		const accessibility = clamp(finiteOr(accessibilityGain, 1), 0, 1.2);
		const environment = clamp(finiteOr(environmentGain, 1), 0, 2);
		let total = base * duck * override * source * occlusion * accessibility * environment * this.masterVolume;
		if (CRITICAL.has(key)) total = Math.max(total, Math.min(this.masterVolume, base * 0.22 * source * accessibility));
		total = clamp(total, 0, this.maxOutput);
		return freeze({ version: 1, channel: key, priority: clamp(Math.round(finiteOr(priority, 30)), 0, 100), base, duck, override, source, occlusion, accessibility, environment, master: this.masterVolume, output: Number(total.toFixed(6)) });
	}

	mix(requests = []) {
		const totals = Object.fromEntries(CHANNELS.map((channel) => [channel, 0]));
		const decisions = requests.map((request) => this.compute(request));
		for (const decision of decisions) totals[decision.channel] += decision.output;
		for (const channel of CHANNELS) totals[channel] = Number(clamp(totals[channel], 0, this.maxOutput).toFixed(6));
		return freeze({ version: 1, sequence: this.sequence, channels: totals, decisions });
	}

	snapshot() { return freeze({ version: 1, sequence: this.sequence, masterVolume: this.masterVolume, maxOutput: this.maxOutput, bases: { ...this.bases }, duckGains: { ...this.duckGains }, overrides: Object.fromEntries(this.overrides) }); }
}

export function createAudioMixEngine(options) { return new AudioMixEngine(options); }
export function audioMixChannels() { return CHANNELS.slice(); }
