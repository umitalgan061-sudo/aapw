/**
 * Player health bar HUD (FAZ 7 dragon combat, run 90, DECISIONS.md ADR-0116). Same DOM-ownership,
 * self-subscribing pattern `ui/worldEventToast.js` already established: owns its own DOM, listens
 * to the `EventBus` directly instead of `game3d.js` calling a per-frame update method — this widget
 * only ever needs to repaint when health actually changes, never once per frame.
 * @module ui/healthBar
 */

/** How long the damage flash (a brief red pulse on the bar itself) stays applied, in seconds. */
const FLASH_SECONDS = 0.3;

export class HealthBar {
	/**
	 * @param {object} options
	 * @param {import('../eventBus.js').EventBus} options.eventsBus
	 * @param {string} options.healthChangedEventName `EVENTS.PLAYER_HEALTH_CHANGED` — payload
	 *   `{current, maxHealth}`; repaints the fill width + text on every emit, including the one
	 *   `gameplay/health.js` fires synchronously at its own construction (so construction order
	 *   between this class and `createHealthState` doesn't matter — see that module's doc comment).
	 * @param {string} options.damageEventName `EVENTS.PLAYER_DAMAGED` — purely a visual flash cue
	 *   here (this widget never reads `amount`); the actual health-number change still arrives via
	 *   `healthChangedEventName`, emitted by `gameplay/health.js` in response to the same event.
	 * @param {HTMLElement} [options.container] Defaults to `document.body`.
	 */
	constructor({ eventsBus, healthChangedEventName, damageEventName, container = document.body }) {
		this._el = document.createElement('div');
		this._el.className = 'g3d-health-bar';
		this._el.setAttribute('role', 'meter');
		this._el.setAttribute('aria-label', 'Can');
		this._el.setAttribute('aria-valuemin', '0');

		const label = document.createElement('p');
		label.className = 'g3d-health-bar-label';
		label.textContent = 'Can';
		this._el.appendChild(label);

		const track = document.createElement('div');
		track.className = 'g3d-health-bar-track';
		this._fillEl = document.createElement('div');
		this._fillEl.className = 'g3d-health-bar-fill';
		track.appendChild(this._fillEl);
		this._el.appendChild(track);

		this._textEl = document.createElement('p');
		this._textEl.className = 'g3d-health-bar-text';
		this._el.appendChild(this._textEl);

		container.appendChild(this._el);

		this._flashTimeoutId = null;
		this._onHealthChanged = (payload) => this._paint(payload);
		this._onDamage = () => this._flash();
		eventsBus.on(healthChangedEventName, this._onHealthChanged);
		eventsBus.on(damageEventName, this._onDamage);
		this._eventsBus = eventsBus;
		this._healthChangedEventName = healthChangedEventName;
		this._damageEventName = damageEventName;
	}

	/** @param {{current: number, maxHealth: number}} payload */
	_paint({ current, maxHealth }) {
		const ratio = maxHealth > 0 ? Math.max(0, Math.min(1, current / maxHealth)) : 0;
		this._fillEl.style.width = `${(ratio * 100).toFixed(1)}%`;
		this._textEl.textContent = `${Math.ceil(current)} / ${maxHealth}`;
		this._el.setAttribute('aria-valuemax', String(maxHealth));
		this._el.setAttribute('aria-valuenow', String(Math.max(0, Math.min(maxHealth, Math.ceil(current)))));
		this._el.setAttribute('aria-valuetext', `${Math.ceil(current)} / ${maxHealth}`);
		this._el.classList.toggle('g3d-health-bar-low', ratio > 0 && ratio <= 0.25);
	}

	_flash() {
		this._el.classList.add('g3d-health-bar-flash');
		if (this._flashTimeoutId !== null) clearTimeout(this._flashTimeoutId);
		this._flashTimeoutId = setTimeout(() => {
			this._el.classList.remove('g3d-health-bar-flash');
			this._flashTimeoutId = null;
		}, FLASH_SECONDS * 1000);
	}

	/** Removes the DOM node, both EventBus subscriptions, and cancels any pending flash timer —
	 * memory-leak checklist. */
	dispose() {
		this._eventsBus.off(this._healthChangedEventName, this._onHealthChanged);
		this._eventsBus.off(this._damageEventName, this._onDamage);
		if (this._flashTimeoutId !== null) clearTimeout(this._flashTimeoutId);
		this._el.remove();
	}
}
