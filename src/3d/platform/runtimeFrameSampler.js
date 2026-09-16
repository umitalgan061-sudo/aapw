/**
 * Low-overhead frame sampling utility.
 *
 * The existing game loop remains the frame clock owner. This helper accepts frame timestamps or delta
 * values and emits a bounded sample only when the caller asks. It supports deterministic replay fixtures,
 * warm-up periods, cadence thinning and explicit reset/dispose behavior.
 */

const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;

export class RuntimeFrameSampler {
	constructor({ warmupFrames = 30, maxSamples = 120, sampleEvery = 1, clock = () => 0 } = {}) {
		this.warmupFrames = clamp(Math.round(finiteOr(warmupFrames, 30)), 0, 300);
		this.maxSamples = clamp(Math.round(finiteOr(maxSamples, 120)), 16, 240);
		this.sampleEvery = clamp(Math.round(finiteOr(sampleEvery, 1)), 1, 12);
		this.clock = typeof clock === 'function' ? clock : () => 0;
		this.lastTime = null;
		this.frameCount = 0;
		this.samples = [];
		this.disposed = false;
	}

	recordTimestamp(timestamp = this.clock()) {
		if (this.disposed || !Number.isFinite(timestamp)) return null;
		this.frameCount += 1;
		if (this.lastTime === null) {
			this.lastTime = timestamp;
			return null;
		}
		const delta = clamp(timestamp - this.lastTime, 0, 250);
		this.lastTime = timestamp;
		if (this.frameCount <= this.warmupFrames || this.frameCount % this.sampleEvery !== 0) return null;
		this.samples = [...this.samples.slice(-(this.maxSamples - 1)), delta];
		return delta;
	}

	recordDelta(deltaMs) {
		if (this.disposed || !Number.isFinite(deltaMs)) return false;
		this.frameCount += 1;
		if (this.frameCount <= this.warmupFrames || this.frameCount % this.sampleEvery !== 0) return false;
		this.samples = [...this.samples.slice(-(this.maxSamples - 1)), clamp(deltaMs, 0, 250)];
		return true;
	}

	values() { return this.samples.slice(); }
	get size() { return this.samples.length; }
	get framesSeen() { return this.frameCount; }

	stats() {
		const values = this.samples.slice().sort((a, b) => a - b);
		if (!values.length) return freeze({ count: 0, mean: 0, min: 0, max: 0, p50: 0, p95: 0 });
		const pick = (q) => values[(values.length - 1) * q | 0];
		const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
		return freeze({ count: values.length, mean: Number(mean.toFixed(4)), min: values[0], max: values.at(-1), p50: pick(0.5), p95: pick(0.95) });
	}

	reset() {
		this.lastTime = null;
		this.frameCount = 0;
		this.samples = [];
	}

	dispose() {
		this.disposed = true;
		this.reset();
	}

	snapshot() { return freeze({ version: 1, disposed: this.disposed, framesSeen: this.frameCount, sampleCount: this.samples.length, warmupFrames: this.warmupFrames, sampleEvery: this.sampleEvery, maxSamples: this.maxSamples, stats: this.stats() }); }
}

export function createRuntimeFrameSampler(options) { return new RuntimeFrameSampler(options); }
