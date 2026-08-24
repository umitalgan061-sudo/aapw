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
 * @param {string} options.healthChangedEventName `EVENTS.PLAYER_HEALTH_CHANGED` — emitted once
 *   synchronously at construction and after every real health mutation. The receipt carries
 *   `{current, maxHealth, ratio, delta, reason, appliedAmount, sourceId}` so combat/UI/audio/VFX
 *   consumers can observe the authoritative post-mitigation health result without recalculating it.
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
	let hasDied = false;

	function emitHealthChanged({ previous = current, reason = 'sync', sourceId = null } = {}) {
		const delta = current - previous;
		eventsBus.emit(healthChangedEventName, Object.freeze({
			current,
			maxHealth,
			ratio: Number((current / maxHealth).toFixed(4)),
			delta,
			reason,
			appliedAmount: reason === 'damage' ? Math.max(0, -delta) : 0,
			sourceId,
		}));
	}

	function onDamage(payload) {
		const amount = payload?.amount;
		if (typeof amount !== 'number' || !(amount > 0)) return;
		if (hasDied) {
			if (payload && typeof payload === 'object') payload.appliedAmount = 0;
			return;
		}
		const previous = current;
		current = Math.max(0, current - amount);
		const appliedAmount = previous - current;
		if (payload && typeof payload === 'object') payload.appliedAmount = appliedAmount;
		emitHealthChanged({ previous, reason: 'damage', sourceId: payload?.sourceId ?? null });
		if (current === 0 && !hasDied) {
			hasDied = true;
			eventsBus.emit(diedEventName, Object.freeze({
				sourceId: payload?.sourceId ?? null,
				current,
				maxHealth,
				appliedAmount,
			}));
		}
	}

	eventsBus.on(damageEventName, onDamage);
	emitHealthChanged();

	return {
		get current() { return current; },
		get maxHealth() { return maxHealth; },
		get isDead() { return hasDied; },

		/** Restores health, capped at `maxHealth`, and re-arms death after a real heal. */
		heal(amount) {
			if (typeof amount !== 'number' || !(amount > 0)) return;
			const previous = current;
			const next = Math.min(maxHealth, current + amount);
			if (next === current) return;
			current = next;
			if (current > 0) hasDied = false;
			emitHealthChanged({ previous, reason: 'heal' });
		},

		/** Restores `current` to `maxHealth` and re-arms `diedEventName` unconditionally. */
		reset() {
			const previous = current;
			current = maxHealth;
			hasDied = false;
			emitHealthChanged({ previous, reason: 'reset' });
		},

		/** Unsubscribes from `damageEventName` — memory-leak checklist. */
		dispose() {
			eventsBus.off(damageEventName, onDamage);
		},
	};
}
