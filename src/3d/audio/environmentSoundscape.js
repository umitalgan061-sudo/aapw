/**
 * Adaptive world soundscape.
 *
 * Converts the simulation's already-authoritative world signals into a small set of continuous procedural
 * layers. No geography is inferred here: callers explicitly provide the active environment, water
 * proximity and storm intensity. This keeps audio from becoming a hidden world-state authority.
 */

import { createImmersiveAudioPolicy } from './immersiveAudioPolicy.js';

const ENVIRONMENTS = Object.freeze(['plains', 'forest', 'coast', 'river', 'mountain', 'settlement', 'castle', 'ice', 'night', 'storm', 'unknown']);
const LAYERS = Object.freeze(['wind', 'water', 'rain', 'fire', 'ambience']);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };

const BASE = Object.freeze({
	plains: { wind: 0.24, water: 0.02, rain: 0, fire: 0.02, ambience: 0.2 },
	forest: { wind: 0.17, water: 0.04, rain: 0, fire: 0.03, ambience: 0.3 },
	coast: { wind: 0.35, water: 0.4, rain: 0, fire: 0.01, ambience: 0.22 },
	river: { wind: 0.16, water: 0.48, rain: 0, fire: 0.01, ambience: 0.24 },
	mountain: { wind: 0.36, water: 0.02, rain: 0, fire: 0, ambience: 0.14 },
	settlement: { wind: 0.1, water: 0.02, rain: 0, fire: 0.2, ambience: 0.4 },
	castle: { wind: 0.12, water: 0.01, rain: 0, fire: 0.28, ambience: 0.33 },
	ice: { wind: 0.4, water: 0.08, rain: 0, fire: 0, ambience: 0.12 },
	night: { wind: 0.2, water: 0.08, rain: 0, fire: 0.02, ambience: 0.13 },
	storm: { wind: 0.62, water: 0.24, rain: 0.68, fire: 0, ambience: 0.28 },
	unknown: { wind: 0.15, water: 0.02, rain: 0, fire: 0, ambience: 0.15 },
});

function normalizeEnvironment(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function lerp(a, b, t) { return a + (b - a) * t; }

export class EnvironmentSoundscape {
	constructor({ bank, policy, transitionRate = 2.8 } = {}) {
		this.bank = bank ?? null;
		this.policy = policy ?? createImmersiveAudioPolicy();
		this.transitionRate = clamp(finiteOr(transitionRate, 2.8), 0.1, 12);
		this.environment = 'unknown';
		this.layers = Object.fromEntries(LAYERS.map((layer) => [layer, 0]));
		this.targetLayers = Object.fromEntries(LAYERS.map((layer) => [layer, 0]));
		this.timePhase = 0;
		this.sequence = 0;
		this.disposed = false;
	}

	setEnvironment(environment, { nightFactor = 0, stormIntensity = 0, waterProximity = 0, windIntensity = 1, fireIntensity = 1 } = {}) {
		if (this.disposed) return this.snapshot();
		this.environment = normalizeEnvironment(environment);
		const base = BASE[this.environment];
		const night = clamp(finiteOr(nightFactor, 0), 0, 1);
		const storm = clamp(finiteOr(stormIntensity, 0), 0, 1);
		const water = clamp(finiteOr(waterProximity, 0), 0, 1);
		const wind = clamp(finiteOr(windIntensity, 1), 0, 2);
		const fire = clamp(finiteOr(fireIntensity, 1), 0, 2);
		this.targetLayers = {
			wind: clamp(base.wind * wind + night * 0.03 + storm * 0.45, 0, 1),
			water: clamp(base.water + water * 0.48 + storm * 0.08, 0, 1),
			rain: clamp(base.rain + storm * 0.72, 0, 1),
			fire: clamp(base.fire * fire, 0, 1),
			ambience: clamp(base.ambience * (1 - night * 0.2) + (this.environment === 'night' ? 0.05 : 0), 0, 1),
		};
		this.sequence += 1;
		return this.snapshot();
	}

	update(deltaSeconds = 0.016) {
		if (this.disposed) return this.snapshot();
		const dt = clamp(finiteOr(deltaSeconds, 0), 0, 0.25);
		const t = clamp(dt * this.transitionRate, 0, 1);
		for (const layer of LAYERS) {
			this.layers[layer] = lerp(this.layers[layer], this.targetLayers[layer], t);
			this.bank?.setLayerGain?.(layer, this.layers[layer] * (this.policy.listener?.masterVolume ?? 1));
		}
		this.timePhase += dt;
		this.sequence += 1;
		return this.snapshot();
	}

	triggerStormPulse({ intensity = 0.5 } = {}) { const gain = clamp(finiteOr(intensity, 0.5), 0, 1) * 0.45; return this.bank?.triggerPulse?.('rain', { gain, frequency: 820, duration: 0.12 }) ?? false; }
	triggerDragonPulse({ intensity = 0.6 } = {}) { return this.bank?.playDragonPulse?.(clamp(finiteOr(intensity, 0.6), 0, 1) * 0.5) ?? false; }
	triggerCombatPulse({ intensity = 0.5 } = {}) { return this.bank?.playCombatPulse?.(clamp(finiteOr(intensity, 0.5), 0, 1) * 0.42) ?? false; }
	triggerFootstep({ intensity = 0.5 } = {}) { return this.bank?.playFootstep?.(clamp(finiteOr(intensity, 0.5), 0, 1) * 0.25) ?? false; }

	snapshot() { return freeze({ version: 1, environment: this.environment, sequence: this.sequence, disposed: this.disposed, layers: { ...this.layers }, targets: { ...this.targetLayers }, timePhase: Number(this.timePhase.toFixed(4)) }); }
	dispose() { if (this.disposed) return; this.disposed = true; for (const layer of LAYERS) this.bank?.setLayerGain?.(layer, 0); }
}

export function createEnvironmentSoundscape(options) { return new EnvironmentSoundscape(options); }
export function environmentSoundscapeConstants() { return freeze({ environments: ENVIRONMENTS, layers: LAYERS, base: BASE }); }
