/**
 * Semantic audio stem director.
 *
 * Separates long-running layers from one-shot cues. A stem is identified semantically rather than by a
 * file path, which lets authored music or future procedural tracks bind later without changing game-state
 * code. Transitions are advanced by the caller's delta and use equal-power curves from audioCurveMath.
 */

import { equalPowerCrossfade, exponentialApproach } from './audioCurveMath.js';

const STEMS = Object.freeze(['exploration', 'settlement', 'combat', 'danger', 'night', 'storm', 'victory', 'pause', 'defeat']);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };

export class AudioStemDirector {
	constructor({ maxStems = 3, transitionSeconds = 1.2 } = {}) {
		this.maxStems = clamp(Math.round(finiteOr(maxStems, 3)), 1, STEMS.length);
		this.transitionSeconds = clamp(finiteOr(transitionSeconds, 1.2), 0.05, 10);
		this.active = [];
		this.targets = new Map();
		this.sequence = 0;
		this.time = 0;
	}

	request(stem, { intensity = 1, priority = 10, force = false } = {}) {
		if (!STEMS.includes(stem)) return null;
		const item = { stem, intensity: clamp(finiteOr(intensity, 1), 0, 1), priority: clamp(Math.round(finiteOr(priority, 10)), 0, 100), force };
		this.targets.set(stem, item);
		if (force || !this.active.find((entry) => entry.stem === stem)) {
			this.active.push({ ...item, gain: 0 });
			this.active.sort((a, b) => b.priority - a.priority);
			if (this.active.length > this.maxStems) this.active = this.active.slice(0, this.maxStems);
		}
		this.sequence += 1;
		return this.snapshot();
	}

	clear(stem) { const removed = this.targets.delete(stem); if (removed) this.sequence += 1; return removed; }

	update(deltaSeconds = 0.016) {
		const dt = clamp(finiteOr(deltaSeconds, 0.016), 0, 0.25);
		this.time += dt;
		const wanted = this.active.map((entry) => this.targets.get(entry.stem)).filter(Boolean);
		const maxPriority = wanted.reduce((max, entry) => Math.max(max, entry.priority), 0);
		for (const entry of this.active) {
			const target = this.targets.get(entry.stem);
			const desired = target ? target.intensity : 0;
			const focus = target && target.priority >= maxPriority ? 1 : 0.35;
			entry.gain = exponentialApproach(entry.gain, desired * focus, dt, this.transitionSeconds);
		}
		this.active = this.active.filter((entry) => entry.gain > 0.001 || this.targets.has(entry.stem));
		this.sequence += 1;
		return this.snapshot();
	}

	crossfade(stem, progress = 0.5) { const curve = equalPowerCrossfade(progress); const entry = this.active.find((item) => item.stem === stem); return freeze({ stem, outGain: curve.out, inGain: curve.in, activeGain: entry?.gain ?? 0 }); }
	snapshot() { return freeze({ version: 1, sequence: this.sequence, maxStems: this.maxStems, time: Number(this.time.toFixed(4)), active: this.active.map((entry) => ({ stem: entry.stem, priority: entry.priority, gain: Number(entry.gain.toFixed(5)) })), targets: [...this.targets.values()].map((entry) => ({ stem: entry.stem, priority: entry.priority, intensity: entry.intensity })) }); }
}

export function createAudioStemDirector(options) { return new AudioStemDirector(options); }
export function audioStemConstants() { return freeze({ stems: STEMS }); }
