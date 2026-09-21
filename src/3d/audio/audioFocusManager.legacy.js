/**
 * Focus-aware foreground audio policy.
 *
 * Browser visibility, pause state and debug free-camera state can make the same soundscape feel wrong
 * when the user is not actually interacting. Existing lifecycle owners feed the focus state here; no DOM
 * visibility listener is installed by this module. The policy differentiates active play, menu, background,
 * debug and recovery modes and returns bounded mix targets.
 */

const FOCUS = Object.freeze({ PLAYING: 'playing', MENU: 'menu', BACKGROUND: 'background', DEBUG: 'debug', RECOVERY: 'recovery', UNKNOWN: 'unknown' });
const TARGETS = Object.freeze({
	playing: { master: 1, ambience: 1, music: 1, ui: 1, positional: 1 },
	menu: { master: 0.8, ambience: 0.25, music: 0.65, ui: 1, positional: 0.2 },
	background: { master: 0.25, ambience: 0, music: 0.15, ui: 0, positional: 0 },
	debug: { master: 0.55, ambience: 0.45, music: 0.45, ui: 1, positional: 0.4 },
	recovery: { master: 0.5, ambience: 0.2, music: 0.3, ui: 1, positional: 0.4 },
	unknown: { master: 0.7, ambience: 0.5, music: 0.5, ui: 0.8, positional: 0.5 },
});
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };
function safeFocus(value) { return Object.values(FOCUS).includes(value) ? value : FOCUS.UNKNOWN; }

export class AudioFocusManager {
	constructor({ transitionSeconds = 0.18 } = {}) {
		this.transitionSeconds = clamp(finiteOr(transitionSeconds, 0.18), 0.02, 2);
		this.focus = FOCUS.UNKNOWN;
		this.target = { ...TARGETS.unknown };
		this.current = { ...TARGETS.unknown };
		this.sequence = 0;
	}

	setFocus(value) {
		this.focus = safeFocus(value);
		this.target = { ...TARGETS[this.focus] };
		this.sequence += 1;
		return this.snapshot();
	}

	update(deltaSeconds = 0.016) {
		const t = clamp(finiteOr(deltaSeconds, 0.016) / this.transitionSeconds, 0, 1);
		for (const key of Object.keys(this.current)) this.current[key] += (this.target[key] - this.current[key]) * t;
		this.sequence += 1;
		return this.snapshot();
	}

	output(group) { return Number(clamp(this.current[group] ?? this.current.ambience, 0, 1).toFixed(5)); }
	snapshot() { return freeze({ version: 1, focus: this.focus, sequence: this.sequence, current: Object.fromEntries(Object.entries(this.current).map(([key, value]) => [key, Number(value.toFixed(5))])), target: { ...this.target } }); }
}

export function createAudioFocusManager(options) { return new AudioFocusManager(options); }
export function audioFocusConstants() { return freeze({ modes: FOCUS, targets: TARGETS }); }
