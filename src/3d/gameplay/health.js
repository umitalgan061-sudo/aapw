/**
 * Generic health/damage state (FAZ 7 dragon combat, run 90, DECISIONS.md ADR-0116) — this project's
 * first health system of any kind. Deliberately generic (not "player health" by name): a plain
 * clamped counter that reacts to EventBus damage events and re-emits its own change/death events,
 * same "systems talk only through the EventBus, never hold a direct reference to each other"
 * architecture `eventBus.js`'s own header describes. `game3d.js` is the only current owner (one
 * instance, for the player), but nothing here assumes that — a future NPC/animal health bar could
 * reuse this unchanged.
 *
 * Deterministic and side-effect-free apart from the EventBus emits it's explicitly built to make —
 * no `Math.random()`, no DOM, no timers (see GOVERNANCE.md §5).
 * @module gameplay/health
 */

/**
 * @param {object} options
 * @param {import('../eventBus.js').EventBus} options.eventsBus
 * @param {number} options.maxHealth Starting and maximum health. Must be a positive number.
 * @param {string} options.damageEventName `EVENTS.PLAYER_DAMAGED` — listened to; payload shape
 *   `{amount: number, sourceId?: string}`. A non-positive or non-numeric `amount` is ignored (no
 *   accidental healing via a malformed damage event, no-op rather than a thrown error since a
 *   broken listener/payload should degrade gracefully like every other GOVERNANCE.md §8.13 subsystem).
 * @param {string} options.healthChangedEventName `EVENTS.PLAYER_HEALTH_CHANGED` — emitted (with
 *   `{current, maxHealth}`) once synchronously at construction (so a `ui/healthBar.js` instance
 *   created *before* this one still gets its initial full-bar paint) and again on every `damage()`/
 *   `heal()`/`reset()` call that actually changes `current`.
 * @param {string} options.diedEventName `EVENTS.PLAYER_DIED` — emitted once, edge-triggered, the
 *   instant `current` reaches exactly 0. Never re-fires while still dead; `heal()`/`reset()` re-arm
 *   it (see their own doc comments).
 * @returns {{
 *   readonly current: number,
 *   readonly maxHealth: number,
 *   readonly isDead: boolean,
 *   heal: (amount: number) => void,
 *   reset: () => void,
 *   dispose: () => void,
 * }}
 */
export function createHealthState({ eventsBus, maxHealth, damageEventName, healthChangedEventName, diedEventName }) {
	let current = maxHealth;
	// Edge-trigger for `diedEventName` — mirrors every other one-shot-until-re-armed flag already in
	// this codebase (`dragonController.js`'s `playerWasInNoticeRadius`/`pursuitExhausted`): `current`
	// can sit at exactly 0 across many frames/damage events without re-emitting "died" each time.
	let hasDied = false;

	function emitHealthChanged() {
		eventsBus.emit(healthChangedEventName, { current, maxHealth });
	}

	function onDamage(payload) {
		const amount = payload?.amount;
		if (typeof amount !== 'number' || !(amount > 0) || hasDied) return;
		current = Math.max(0, current - amount);
		emitHealthChanged();
		if (current === 0 && !hasDied) {
			hasDied = true;
			eventsBus.emit(diedEventName, { sourceId: payload?.sourceId });
		}
	}

	eventsBus.on(damageEventName, onDamage);
	// Synchronous initial paint (see `healthChangedEventName`'s own doc comment above) — deliberately
	// after subscribing to `damageEventName` (not that it matters here, since nothing can emit damage
	// during this same synchronous construction), but strictly *before* returning, so any caller that
	// constructs `ui/healthBar.js` first and this second never misses it.
	emitHealthChanged();

	return {
		get current() { return current; },
		get maxHealth() { return maxHealth; },
		get isDead() { return hasDied; },

		/**
		 * Restores health, capped at `maxHealth`. A positive `amount` while `current` is already 0
		 * re-arms `diedEventName` (an amount that only brings `current` back to 0 exactly, i.e. no real
		 * healing happened, does not re-arm — matches `damage()`'s own "only real changes emit" rule).
		 * @param {number} amount
		 */
		heal(amount) {
			if (typeof amount !== 'number' || !(amount > 0)) return;
			const next = Math.min(maxHealth, current + amount);
			if (next === current) return;
			current = next;
			if (current > 0) hasDied = false;
			emitHealthChanged();
		},

		/** Restores `current` to `maxHealth` and re-arms `diedEventName` unconditionally — the
		 * respawn-after-death path (`game3d.js`'s `PLAYER_DIED` handler) calls this, not `heal()`,
		 * so a respawn is always a full heal regardless of how much damage was actually taken. */
		reset() {
			current = maxHealth;
			hasDied = false;
			emitHealthChanged();
		},

		/** Unsubscribes from `damageEventName` — memory-leak checklist. */
		dispose() {
			eventsBus.off(damageEventName, onDamage);
		},
	};
}
