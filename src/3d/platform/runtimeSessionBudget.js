/**
 * Session workload budget ledger.
 *
 * Runtime systems frequently need short-lived coordination without inventing global counters. This
 * ledger tracks bounded work units for terrain streaming, asset hydration, animation and diagnostics.
 * It is deliberately integer/float-light, deterministic, resettable and free of timers.
 */

const CHANNELS = Object.freeze(['terrain', 'assets', 'animation', 'effects', 'ui', 'diagnostics']);
const DEFAULT_LIMITS = Object.freeze({
	terrain: 6,
	assets: 4,
	animation: 56,
	effects: 12,
	ui: 4,
	diagnostics: 2,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};

function normalizeLimits(limits) {
	const output = {};
	for (const channel of CHANNELS) {
		output[channel] = clamp(Math.round(finiteOr(limits?.[channel], DEFAULT_LIMITS[channel])), 0, 512);
	}
	return output;
}

export class RuntimeSessionBudget {
	constructor({ limits, now = () => 0 } = {}) {
		this.limits = freeze(normalizeLimits(limits));
		this.now = typeof now === 'function' ? now : () => 0;
		this.used = Object.fromEntries(CHANNELS.map((channel) => [channel, 0]));
		this.peak = Object.fromEntries(CHANNELS.map((channel) => [channel, 0]));
		this.sequence = 0;
	}

	setLimit(channel, value) {
		if (!CHANNELS.includes(channel) || !Number.isFinite(value)) return false;
		this.limits = freeze({ ...this.limits, [channel]: clamp(Math.round(value), 0, 512) });
		this.sequence += 1;
		return true;
	}

	reserve(channel, amount = 1) {
		if (!CHANNELS.includes(channel) || !Number.isFinite(amount) || amount < 0) return false;
		const next = this.used[channel] + amount;
		if (next > this.limits[channel]) return false;
		this.used[channel] = next;
		this.peak[channel] = Math.max(this.peak[channel], next);
		this.sequence += 1;
		return true;
	}

	release(channel, amount = 1) {
		if (!CHANNELS.includes(channel) || !Number.isFinite(amount) || amount < 0) return false;
		this.used[channel] = Math.max(0, this.used[channel] - amount);
		this.sequence += 1;
		return true;
	}

	available(channel) {
		if (!CHANNELS.includes(channel)) return 0;
		return Math.max(0, this.limits[channel] - this.used[channel]);
	}

	utilization(channel) {
		if (!CHANNELS.includes(channel) || this.limits[channel] <= 0) return 1;
		return clamp(this.used[channel] / this.limits[channel], 0, 1);
	}

	withReservation(channel, amount, fn) {
		if (!this.reserve(channel, amount)) return { admitted: false, result: undefined };
		try {
			return { admitted: true, result: fn?.() };
		} finally {
			this.release(channel, amount);
		}
	}

	reset() {
		for (const channel of CHANNELS) {
			this.used[channel] = 0;
			this.peak[channel] = 0;
		}
		this.sequence += 1;
	}

	snapshot() {
		const utilization = Object.fromEntries(CHANNELS.map((channel) => [channel, Number(this.utilization(channel).toFixed(4))]));
		return freeze({
			version: 1,
			sequence: this.sequence,
			timestamp: finiteOr(this.now(), 0),
			limits: { ...this.limits },
			used: { ...this.used },
			peak: { ...this.peak },
			utilization,
		});
	}
}

export function createRuntimeSessionBudget(options) { return new RuntimeSessionBudget(options); }
export function runtimeBudgetChannels() { return CHANNELS.slice(); }
