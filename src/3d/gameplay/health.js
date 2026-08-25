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

const pendingDamageResolutions = new WeakMap();

function isObjectPayload(payload) {
	return payload !== null && (typeof payload === 'object' || typeof payload === 'function');
}

function tryWrite(payload, key, value) {
	if (!isObjectPayload(payload)) return false;
	try {
		return Reflect.set(payload, key, value);
	} catch {
		return false;
	}
}

/**
 * Stage same-event defense/health data without requiring producer payload mutability.
 * Mutable payloads retain the legacy best-effort write-back for existing consumers.
 */
export function stageDamageResolution(payload, patch = {}) {
	if (!isObjectPayload(payload)) return null;
	const previous = pendingDamageResolutions.get(payload) ?? {};
	const next = Object.freeze({ ...previous, ...patch });
	pendingDamageResolutions.set(payload, next);
	for (const [key, value] of Object.entries(patch)) tryWrite(payload, key, value);
	return next;
}

export function readDamageResolution(payload) {
	return isObjectPayload(payload) ? (pendingDamageResolutions.get(payload) ?? null) : null;
}

export function clearDamageResolution(payload) {
	if (isObjectPayload(payload)) pendingDamageResolutions.delete(payload);
}

function writeDamageAppliedAmount(payload, appliedAmount) {
	if (!isObjectPayload(payload)) return false;
	const previous = pendingDamageResolutions.get(payload) ?? {};
	pendingDamageResolutions.set(payload, Object.freeze({ ...previous, appliedAmount }));
	return tryWrite(payload, 'appliedAmount', appliedAmount);
}

export function createHealthState({ eventsBus, maxHealth, damageEventName, healthChangedEventName, diedEventName }) {
	if (!Number.isFinite(maxHealth) || !(maxHealth > 0)) {
		throw new RangeError('createHealthState maxHealth must be a finite positive number');
	}
	let current = maxHealth;
	let hasDied = false;

	function clearResolutionAfterSameEvent(payload) {
		// Preserve the authoritative snapshot through the first microtask wave so listeners
		// registered after health can defer their own same-event reconciliation without racing cleanup.
		queueMicrotask(() => queueMicrotask(() => clearDamageResolution(payload)));
	}

	function emitHealthChanged({ previous = current, reason = 'sync', sourceId = null } = {}) {
		const delta = current - previous;
		const receipt = { current, maxHealth };
		Object.defineProperties(receipt, {
			ratio: { value: Number((current / maxHealth).toFixed(4)), enumerable: false },
			delta: { value: delta, enumerable: false },
			reason: { value: reason, enumerable: false },
			appliedAmount: { value: reason === 'damage' ? Math.max(0, -delta) : 0, enumerable: false },
			sourceId: { value: sourceId, enumerable: false },
		});
		eventsBus.emit(healthChangedEventName, Object.freeze(receipt));
	}

	function onDamage(payload) {
		const stagedResolution = readDamageResolution(payload);
		const amount = stagedResolution?.amount ?? payload?.amount;
		if (!Number.isFinite(amount) || !(amount > 0)) {
			if (stagedResolution) {
				if (Number.isFinite(amount) && amount === 0) writeDamageAppliedAmount(payload, 0);
				clearResolutionAfterSameEvent(payload);
			}
			return;
		}
		if (hasDied) {
			writeDamageAppliedAmount(payload, 0);
			clearResolutionAfterSameEvent(payload);
			return;
		}
		const previous = current;
		current = Math.max(0, current - amount);
		const appliedAmount = previous - current;
		writeDamageAppliedAmount(payload, appliedAmount);
		emitHealthChanged({ previous, reason: 'damage', sourceId: payload?.sourceId ?? null });
		if (current === 0 && !hasDied) {
			hasDied = true;
			const deathReceipt = { sourceId: payload?.sourceId ?? null };
			Object.defineProperties(deathReceipt, {
				current: { value: current, enumerable: false },
				maxHealth: { value: maxHealth, enumerable: false },
				appliedAmount: { value: appliedAmount, enumerable: false },
			});
			eventsBus.emit(diedEventName, Object.freeze(deathReceipt));
		}
		clearResolutionAfterSameEvent(payload);
	}

	eventsBus.on(damageEventName, onDamage);
	emitHealthChanged();

	return {
		get current() { return current; },
		get maxHealth() { return maxHealth; },
		get isDead() { return hasDied; },
		heal(amount) {
			if (!Number.isFinite(amount) || !(amount > 0)) return;
			const previous = current;
			const next = Math.min(maxHealth, current + amount);
			if (next === current) return;
			current = next;
			if (current > 0) hasDied = false;
			emitHealthChanged({ previous, reason: 'heal' });
		},
		reset() {
			const previous = current;
			current = maxHealth;
			hasDied = false;
			emitHealthChanged({ previous, reason: 'reset' });
		},
		dispose() {
			eventsBus.off(damageEventName, onDamage);
		},
	};
}