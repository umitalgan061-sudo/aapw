/**
 * Transient safety limiter.
 *
 * High-priority events like combat hits, dragon roars and UI transitions should remain audible without
 * creating clipping or sudden gain spikes when several events coincide. This pure module applies a
 * bounded peak envelope to abstract cue gains before they enter the Web Audio graph.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };

export class AudioTransientLimiter {
	constructor({ ceiling = 0.92, releaseSeconds = 0.12, attackSeconds = 0.005 } = {}) {
		this.ceiling = clamp(finiteOr(ceiling, 0.92), 0.4, 1);
		this.releaseSeconds = clamp(finiteOr(releaseSeconds, 0.12), 0.01, 2);
		this.attackSeconds = clamp(finiteOr(attackSeconds, 0.005), 0.001, 0.2);
		this.envelope = 0;
		this.sequence = 0;
	}

	process(peak, deltaSeconds = 0.016) {
		const safePeak = clamp(finiteOr(peak, 0), 0, 2);
		const dt = clamp(finiteOr(deltaSeconds, 0.016), 0, 0.25);
		const target = safePeak;
		const tau = target > this.envelope ? this.attackSeconds : this.releaseSeconds;
		const t = clamp(dt / Math.max(tau, 0.001), 0, 1);
		this.envelope += (target - this.envelope) * t;
		const gain = this.envelope > this.ceiling ? this.ceiling / Math.max(this.envelope, 0.001) : 1;
		this.sequence += 1;
		return freeze({ version: 1, peak: safePeak, envelope: Number(this.envelope.toFixed(5)), gain: Number(clamp(gain, 0, 1).toFixed(5)), limited: gain < 0.9999 });
	}

	reset() { this.envelope = 0; this.sequence += 1; }
	snapshot() { return freeze({ version: 1, ceiling: this.ceiling, releaseSeconds: this.releaseSeconds, attackSeconds: this.attackSeconds, envelope: Number(this.envelope.toFixed(5)), sequence: this.sequence }); }
}

export function createAudioTransientLimiter(options) { return new AudioTransientLimiter(options); }
