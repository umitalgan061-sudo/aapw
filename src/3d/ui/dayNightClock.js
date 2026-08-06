/**
 * In-game day/night clock for FAZ 8 discoverability — the world has run a real, seeded day/night
 * cycle since `lighting.js` (run 8/9-ish) and `gameplay/worldEvents.js` (ADR-0111) has gated flavor
 * events by it since run 86, but nothing on screen ever told the player what time it actually was —
 * only the ambient cue of the sky/lighting itself, same discoverability gap
 * `settlementCompass.js`/`controlsHelp.js` (run 104/106) already closed for direction and controls.
 * Renders a 24-hour HH:MM readout plus a period icon (☀️ day / 🌅 twilight / 🌙 night), both derived
 * from `lighting.js`'s `updateDayNightLighting()` return value — no new state, no gameplay/world
 * import (this file stays inside `ui/`'s own "no camera/gameplay imports" blast-radius rule, see
 * `ui/README.md`'s Conventions — the day/night thresholds below are a small local duplicate of
 * `gameplay/worldEvents.js`'s own `NIGHT_THRESHOLD`/`DAY_THRESHOLD`, the same "duplicate a tiny
 * constant across a folder boundary rather than import across it" precedent `mulberry32` already
 * establishes in that file and in `gameplay/animals.js`/`gameplay/npc.js`).
 * @module ui/dayNightClock
 */

/** Matches `gameplay/worldEvents.js`'s own `NIGHT_THRESHOLD`/`DAY_THRESHOLD` values (ADR-0111) so
 *  the clock's period icon agrees with which flavor events are currently eligible to fire — a
 *  deliberately duplicated pair of numbers, not a shared import (see module doc comment above). */
const NIGHT_ICON_THRESHOLD = 0.6;
const DAY_ICON_THRESHOLD = 0.15;

const ICON_DAY = '☀️';
const ICON_TWILIGHT = '🌅';
const ICON_NIGHT = '🌙';

/** @param {number} n @returns {string} Two-digit, zero-padded. */
function pad2(n) {
	return n < 10 ? `0${n}` : `${n}`;
}

export class DayNightClock {
	/** @param {{container?: HTMLElement}} [options] */
	constructor({ container = document.body } = {}) {
		this._root = document.createElement('aside');
		this._root.className = 'g3d-day-night-clock';
		this._root.setAttribute('aria-label', 'Oyun içi saat');
		this._icon = document.createElement('span');
		this._icon.className = 'g3d-day-night-clock-icon';
		this._icon.textContent = ICON_DAY;
		this._time = document.createElement('span');
		this._time.className = 'g3d-day-night-clock-time';
		this._time.textContent = '00:00';
		this._root.append(this._icon, this._time);
		container.appendChild(this._root);

		// Throttle DOM writes to "the displayed minute actually changed" — same reasoning
		// `settlementCompass.js` uses its 10m distance bucket for, just on the time axis. At this
		// world's default `WORLD_DEFAULTS.DAY_LENGTH_SECONDS` (720s/24h-game-day), one game-minute is
		// half a real second, so this still writes roughly twice a second — deliberate for a
		// compressed cycle, not a bug — but never every single animation frame.
		this._lastMinuteOfDay = -1;
		this._lastIcon = null;
	}

	/**
	 * @param {number} timeRatio `lighting.js`'s `updateDayNightLighting().timeRatio` — [0, 1),
	 *   0 = midnight, 0.5 = noon.
	 * @param {number} nightFactor Same call's `.nightFactor` — 0 = full day, 1 = full night.
	 */
	update(timeRatio, nightFactor) {
		const normalizedRatio = ((timeRatio % 1) + 1) % 1;
		const minuteOfDay = Math.floor(normalizedRatio * 24 * 60);
		if (minuteOfDay !== this._lastMinuteOfDay) {
			const hours = Math.floor(minuteOfDay / 60);
			const minutes = minuteOfDay % 60;
			this._time.textContent = `${pad2(hours)}:${pad2(minutes)}`;
			this._lastMinuteOfDay = minuteOfDay;
		}

		const icon = nightFactor <= DAY_ICON_THRESHOLD
			? ICON_DAY
			: nightFactor >= NIGHT_ICON_THRESHOLD
				? ICON_NIGHT
				: ICON_TWILIGHT;
		if (icon !== this._lastIcon) {
			this._icon.textContent = icon;
			this._lastIcon = icon;
		}
	}

	/** Removes the widget's DOM. No listeners/timers owned, nothing else to release. */
	dispose() {
		this._root.remove();
	}
}
