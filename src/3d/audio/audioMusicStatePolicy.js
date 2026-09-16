/**
 * Adaptive music state policy.
 *
 * AAPW currently has no authored music library, so this policy prepares the state machine without adding
 * music files. Future tracks can bind to the same semantic states: exploration, settlement, combat,
 * danger, night, storm, victory, pause and defeat. State changes use hysteresis so incidental world events
 * do not repeatedly restart a track.
 */

const STATES = Object.freeze(['exploration', 'settlement', 'combat', 'danger', 'night', 'storm', 'victory', 'pause', 'defeat']);
const PRIORITIES = Object.freeze({ exploration: 10, night: 20, settlement: 30, storm: 50, danger: 60, combat: 80, victory: 90, defeat: 100, pause: 110 });
const TRANSITION_SECONDS = Object.freeze({ exploration: 1.5, settlement: 1.2, combat: 0.45, danger: 0.7, night: 1.8, storm: 1.2, victory: 0.35, pause: 0.18, defeat: 0.4 });
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
function state(value) { return STATES.includes(value) ? value : 'exploration'; }

function deriveFromSignals(signals = {}) {
	if (signals.paused) return 'pause';
	if (signals.defeated) return 'defeat';
	if (signals.victory) return 'victory';
	if (signals.combatIntensity >= 0.55) return 'combat';
	if (signals.dangerIntensity >= 0.65) return 'danger';
	if (signals.stormIntensity >= 0.72) return 'storm';
	if (signals.settlement) return 'settlement';
	if (signals.nightFactor >= 0.84) return 'night';
	return 'exploration';
}

export class AudioMusicStatePolicy {
	constructor({ initialState = 'exploration', minimumHoldSeconds = 0.8 } = {}) {
		this.current = state(initialState);
		this.target = this.current;
		this.minimumHoldSeconds = clamp(finiteOr(minimumHoldSeconds, 0.8), 0, 10);
		this.hold = 0;
		this.transition = 1;
		this.sequence = 0;
	}

	updateSignals(signals = {}, deltaSeconds = 0.016) {
		const next = deriveFromSignals({
			paused: signals.paused === true,
			defeated: signals.defeated === true,
			victory: signals.victory === true,
			combatIntensity: clamp(finiteOr(signals.combatIntensity, 0), 0, 1),
			dangerIntensity: clamp(finiteOr(signals.dangerIntensity, 0), 0, 1),
			stormIntensity: clamp(finiteOr(signals.stormIntensity, 0), 0, 1),
			settlement: signals.settlement === true,
			nightFactor: clamp(finiteOr(signals.nightFactor, 0), 0, 1),
		});
		const dt = clamp(finiteOr(deltaSeconds, 0.016), 0, 0.25);
		this.hold += dt;
		if (next !== this.current && (PRIORITIES[next] >= PRIORITIES[this.target] || this.hold >= this.minimumHoldSeconds)) this.target = next;
		if (this.target !== this.current) {
			this.transition = Math.min(1, this.transition + dt / TRANSITION_SECONDS[this.target]);
			if (this.transition >= 1) { this.current = this.target; this.hold = 0; this.transition = 0; }
		}
		this.sequence += 1;
		return this.snapshot();
	}

	request(nextState, { force = false } = {}) {
		const next = state(nextState);
		if (force || PRIORITIES[next] >= PRIORITIES[this.current] || this.hold >= this.minimumHoldSeconds) this.target = next;
		this.sequence += 1;
		return this.snapshot();
	}

	gainFor(stateName) {
		const safe = state(stateName);
		if (safe === this.current) return 1;
		if (safe === this.target) return this.transition;
		return 0;
	}

	snapshot() { return freeze({ version: 1, current: this.current, target: this.target, transition: Number(this.transition.toFixed(5)), holdSeconds: Number(this.hold.toFixed(5)), sequence: this.sequence }); }
}

export function createAudioMusicStatePolicy(options) { return new AudioMusicStatePolicy(options); }
export function audioMusicStateConstants() { return freeze({ states: STATES, priorities: PRIORITIES, transitionSeconds: TRANSITION_SECONDS }); }
