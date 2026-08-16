/**
 * Player vitals HUD (FAZ 7 health + Kızıl Ufuk stamina).
 * Keeps the existing HealthBar API/selectors while adding a second, accessible stamina meter fed
 * by the real player's `aapw:player-motion` telemetry. Both meters share one compact top-right
 * panel so the existing settlement-compass/event-toast layout keeps its ownership and spacing.
 * @module ui/healthBar
 */

/** How long the damage flash (a brief red pulse on the bar itself) stays applied, in seconds. */
const FLASH_SECONDS = 0.3;

const STAMINA_STATE_LABELS = Object.freeze({
	idle: 'Hazır',
	walk: 'Yürüme',
	sprint: 'Depar',
	dodge: 'Kaçınma',
	airborne: 'Havada',
	exhausted: 'Tükendi',
});

export class HealthBar {
	/**
	 * @param {object} options
	 * @param {import('../eventBus.js').EventBus} options.eventsBus
	 * @param {string} options.healthChangedEventName `EVENTS.PLAYER_HEALTH_CHANGED` — payload
	 *   `{current, maxHealth}`; repaints the health fill width + text on every emit.
	 * @param {string} options.damageEventName `EVENTS.PLAYER_DAMAGED` — purely a visual flash cue.
	 * @param {HTMLElement} [options.container] Defaults to `document.body`.
	 */
	constructor({ eventsBus, healthChangedEventName, damageEventName, container = document.body }) {
		this._el = document.createElement('div');
		this._el.className = 'g3d-health-bar g3d-player-vitals';
		this._el.setAttribute('role', 'meter');
		this._el.setAttribute('aria-label', 'Can');
		this._el.setAttribute('aria-valuemin', '0');
		// The existing panel had enough vertical room for exactly one meter before the settlement
		// compass row begins. A two-column grid keeps the total panel height effectively unchanged.
		Object.assign(this._el.style, {
			width: '220px',
			display: 'grid',
			gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
			gridTemplateRows: 'auto auto auto',
			columnGap: '10px',
		});

		const label = document.createElement('p');
		label.className = 'g3d-health-bar-label';
		label.textContent = 'Can';
		Object.assign(label.style, { gridColumn: '1', gridRow: '1' });
		this._el.appendChild(label);

		const track = document.createElement('div');
		track.className = 'g3d-health-bar-track';
		Object.assign(track.style, { gridColumn: '1', gridRow: '2' });
		this._fillEl = document.createElement('div');
		this._fillEl.className = 'g3d-health-bar-fill';
		track.appendChild(this._fillEl);
		this._el.appendChild(track);

		this._textEl = document.createElement('p');
		this._textEl.className = 'g3d-health-bar-text';
		Object.assign(this._textEl.style, { gridColumn: '1', gridRow: '3' });
		this._el.appendChild(this._textEl);

		this._staminaEl = document.createElement('div');
		this._staminaEl.className = 'g3d-stamina-bar';
		this._staminaEl.setAttribute('role', 'meter');
		this._staminaEl.setAttribute('aria-label', 'Dayanıklılık');
		this._staminaEl.setAttribute('aria-valuemin', '0');
		Object.assign(this._staminaEl.style, {
			gridColumn: '2',
			gridRow: '1 / 4',
			display: 'grid',
			gridTemplateRows: 'auto auto auto',
			paddingLeft: '10px',
			borderLeft: '1px solid rgba(200, 150, 10, 0.32)',
		});

		const staminaLabel = document.createElement('p');
		staminaLabel.className = 'g3d-health-bar-label g3d-stamina-bar-label';
		staminaLabel.textContent = 'Dayanıklılık';
		staminaLabel.style.gridRow = '1';
		this._staminaEl.appendChild(staminaLabel);

		const staminaTrack = document.createElement('div');
		staminaTrack.className = 'g3d-health-bar-track g3d-stamina-bar-track';
		staminaTrack.style.gridRow = '2';
		this._staminaFillEl = document.createElement('div');
		this._staminaFillEl.className = 'g3d-health-bar-fill g3d-stamina-bar-fill';
		this._staminaFillEl.style.background = 'linear-gradient(90deg, #8a6b15, #e8c85a)';
		staminaTrack.appendChild(this._staminaFillEl);
		this._staminaEl.appendChild(staminaTrack);

		this._staminaTextEl = document.createElement('p');
		this._staminaTextEl.className = 'g3d-health-bar-text g3d-stamina-bar-text';
		this._staminaTextEl.style.gridRow = '3';
		this._staminaTextEl.textContent = '—';
		this._staminaEl.appendChild(this._staminaTextEl);
		this._el.appendChild(this._staminaEl);

		container.appendChild(this._el);

		this._flashTimeoutId = null;
		this._onHealthChanged = (payload) => this._paint(payload);
		this._onDamage = () => this._flash();
		eventsBus.on(healthChangedEventName, this._onHealthChanged);
		eventsBus.on(damageEventName, this._onDamage);
		this._eventsBus = eventsBus;
		this._healthChangedEventName = healthChangedEventName;
		this._damageEventName = damageEventName;

		this._motionEventTarget = typeof globalThis.addEventListener === 'function' ? globalThis : null;
		this._onPlayerMotion = (event) => this._paintStamina(event?.detail);
		this._motionEventTarget?.addEventListener('aapw:player-motion', this._onPlayerMotion);
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

	/**
	 * Repaints from the same immutable snapshot the controller exposes to runtime acceptance/HUDs.
	 * Invalid or pre-player events are ignored rather than blanking a previously valid meter.
	 * @param {{stamina?: number, maxStamina?: number, state?: string}|undefined} motion
	 */
	_paintStamina(motion) {
		const current = motion?.stamina;
		const maxStamina = motion?.maxStamina;
		if (!Number.isFinite(current) || !Number.isFinite(maxStamina) || !(maxStamina > 0)) return;
		const clamped = Math.max(0, Math.min(maxStamina, current));
		const ratio = clamped / maxStamina;
		const rounded = Math.ceil(clamped);
		const state = typeof motion?.state === 'string' ? motion.state : 'idle';
		const stateLabel = STAMINA_STATE_LABELS[state] ?? state;
		this._staminaFillEl.style.width = `${(ratio * 100).toFixed(1)}%`;
		this._staminaTextEl.textContent = `${rounded} / ${maxStamina}`;
		this._staminaEl.setAttribute('aria-valuemax', String(maxStamina));
		this._staminaEl.setAttribute('aria-valuenow', String(rounded));
		this._staminaEl.setAttribute('aria-valuetext', `${rounded} / ${maxStamina} · ${stateLabel}`);
		this._staminaEl.dataset.state = state;
		this._staminaEl.classList.toggle('g3d-stamina-bar-low', ratio > 0 && ratio <= 0.25);
		this._staminaEl.classList.toggle('g3d-stamina-bar-exhausted', state === 'exhausted');
		this._staminaFillEl.style.background = state === 'exhausted'
			? 'linear-gradient(90deg, #5f513a, #8c7651)'
			: (ratio > 0 && ratio <= 0.25
				? 'linear-gradient(90deg, #7a5a0c, #d99a22)'
				: 'linear-gradient(90deg, #8a6b15, #e8c85a)');
		this._staminaFillEl.style.filter = state === 'dodge' ? 'brightness(1.22)' : '';
	}

	_flash() {
		this._el.classList.add('g3d-health-bar-flash');
		if (this._flashTimeoutId !== null) clearTimeout(this._flashTimeoutId);
		this._flashTimeoutId = setTimeout(() => {
			this._el.classList.remove('g3d-health-bar-flash');
			this._flashTimeoutId = null;
		}, FLASH_SECONDS * 1000);
	}

	/** Removes the DOM node, EventBus/global motion subscriptions, and pending flash timer. */
	dispose() {
		this._eventsBus.off(this._healthChangedEventName, this._onHealthChanged);
		this._eventsBus.off(this._damageEventName, this._onDamage);
		this._motionEventTarget?.removeEventListener('aapw:player-motion', this._onPlayerMotion);
		if (this._flashTimeoutId !== null) clearTimeout(this._flashTimeoutId);
		this._el.remove();
	}
}
