/** Production TypeScript owner for src/3d/gameplay/health.js. Legacy .js remains compatibility-only. */
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

export interface HealthEventBus {
	readonly on: (eventName: string, handler: (payload: unknown) => void) => void;
	readonly off: (eventName: string, handler: (payload: unknown) => void) => void;
	readonly emit: (eventName: string, payload?: unknown) => void;
}
export interface DamageResolution extends Record<string, unknown> {
	readonly amount?: number;
	readonly rawAmount?: number;
	readonly blockedAmount?: number;
	readonly mitigation?: string;
	readonly sourceId?: string | null;
	readonly appliedAmount?: number;
}
export interface HealthEventPayload extends Record<string, unknown> {
	readonly amount?: number;
	readonly sourceId?: string | null;
	readonly appliedAmount?: number;
}
export interface HealthSnapshot {
	readonly current: number;
	readonly max: number;
	readonly ratio: number;
	readonly defeated: boolean;
	readonly revision: number;
}
export interface HealthChangeReceipt {
	readonly current: number;
	readonly maxHealth: number;
	readonly ratio: number;
	readonly delta: number;
	readonly reason: 'sync' | 'damage' | 'heal' | 'reset';
	readonly appliedAmount: number;
	readonly sourceId: string | null;
	readonly revision: number;
}
export interface HealthDeathReceipt {
	readonly current: number;
	readonly maxHealth: number;
	readonly appliedAmount: number;
	readonly sourceId: string | null;
	readonly revision: number;
}
export interface HealthStateOptions {
	readonly eventsBus: HealthEventBus;
	readonly maxHealth: number;
	readonly damageEventName: string;
	readonly healthChangedEventName: string;
	readonly diedEventName: string;
}
export interface HealthState {
	readonly current: number;
	readonly maxHealth: number;
	readonly isDead: boolean;
	readonly revision: number;
	readonly getSnapshot: () => HealthSnapshot;
	readonly heal: (amount: number) => void;
	readonly reset: () => void;
	readonly dispose: () => void;
}

const pendingDamageResolutions = new WeakMap<object, Readonly<DamageResolution>>();

function isObjectPayload(payload: unknown): payload is HealthEventPayload {
	return payload !== null && (typeof payload === 'object' || typeof payload === 'function');
}

function tryWrite(payload: unknown, key: string, value: unknown): boolean {
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
export function stageDamageResolution(payload: unknown, patch: Partial<DamageResolution> = {}): Readonly<DamageResolution> | null {
	if (!isObjectPayload(payload)) return null;
	const previous = pendingDamageResolutions.get(payload) ?? {};
	const next = Object.freeze({ ...previous, ...patch }) as Readonly<DamageResolution>;
	pendingDamageResolutions.set(payload, next);
	for (const [key, value] of Object.entries(patch)) tryWrite(payload, key, value);
	return next;
}

export function readDamageResolution(payload: unknown): Readonly<DamageResolution> | null {
	return isObjectPayload(payload) ? (pendingDamageResolutions.get(payload) ?? null) : null;
}

export function clearDamageResolution(payload: unknown): void {
	if (isObjectPayload(payload)) pendingDamageResolutions.delete(payload);
}

function writeDamageAppliedAmount(payload: unknown, appliedAmount: number): boolean {
	if (!isObjectPayload(payload)) return false;
	const previous = pendingDamageResolutions.get(payload) ?? {};
	pendingDamageResolutions.set(payload, Object.freeze({ ...previous, appliedAmount }) as Readonly<DamageResolution>);
	return tryWrite(payload, 'appliedAmount', appliedAmount);
}

function readDamageSourceId(payload: HealthEventPayload | null, stagedResolution: Readonly<DamageResolution> | null = payload ? readDamageResolution(payload) : null): string | null {
	const stagedSourceId = stagedResolution?.sourceId;
	if (typeof stagedSourceId === 'string') return stagedSourceId;
	if (stagedSourceId === null) return null;
	return typeof payload?.sourceId === 'string' ? payload.sourceId : null;
}
function readNumericResolutionField(resolution: Readonly<DamageResolution> | null, key: keyof DamageResolution): number | undefined {
	const value = resolution?.[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function createHealthState({ eventsBus, maxHealth, damageEventName, healthChangedEventName, diedEventName }: HealthStateOptions): HealthState {
	if (!Number.isFinite(maxHealth) || !(maxHealth > 0)) {
		throw new RangeError('createHealthState maxHealth must be a finite positive number');
	}
	let current = maxHealth;
	let hasDied = false;
	let revision = 0;

	function clearResolutionAfterSameEvent(payload: unknown): void {
		// Preserve the authoritative snapshot through the first microtask wave so listeners
		// registered after health can defer their own same-event reconciliation without racing cleanup.
		// If the same payload object is reused before cleanup, a stale event must not erase the
		// newer event's authoritative resolution.
		const resolution = readDamageResolution(payload);
		queueMicrotask(() => queueMicrotask(() => {
			if (readDamageResolution(payload) === resolution) clearDamageResolution(payload);
		}));
	}

	function emitHealthChanged({
		previous = current,
		reason = 'sync',
		sourceId = null,
	}: {
		readonly previous?: number;
		readonly reason?: HealthChangeReceipt['reason'];
		readonly sourceId?: string | null;
	} = {}): void {
		const delta = current - previous;
		const receipt: HealthChangeReceipt = {
			current,
			maxHealth,
			ratio: Number((current / maxHealth).toFixed(4)),
			delta,
			reason,
			appliedAmount: reason === 'damage' ? Math.max(0, -delta) : 0,
			sourceId,
			revision,
		};
		eventsBus.emit(healthChangedEventName, Object.freeze(receipt));
	}

	function onDamage(payload: unknown): void {
		const eventPayload = isObjectPayload(payload) ? payload : null;
		const stagedResolution = readDamageResolution(eventPayload);
		const stagedAmount = readNumericResolutionField(stagedResolution, 'amount');
		const payloadAmount = eventPayload?.amount;
		const amount = stagedAmount ?? payloadAmount ?? 0;
		if (!Number.isFinite(amount) || !(amount > 0)) {
			if (stagedResolution) {
				if (amount === 0) writeDamageAppliedAmount(eventPayload, 0);
				clearResolutionAfterSameEvent(eventPayload);
			}
			return;
		}
		if (hasDied) {
			writeDamageAppliedAmount(payload, 0);
			clearResolutionAfterSameEvent(payload);
			return;
		}
		const previous = current;
		const sourceId = eventPayload ? readDamageSourceId(eventPayload, stagedResolution) : null;
		current = Math.max(0, current - amount);
		revision += 1;
		const appliedAmount = previous - current;
		writeDamageAppliedAmount(eventPayload, appliedAmount);
		emitHealthChanged({ previous, reason: 'damage', sourceId });
		if (current === 0 && !hasDied) {
			hasDied = true;
			const deathReceipt: HealthDeathReceipt = Object.freeze({
				current,
				maxHealth,
				appliedAmount,
				sourceId,
				revision,
			});
			eventsBus.emit(diedEventName, deathReceipt);
		}
		clearResolutionAfterSameEvent(payload);
	}

	eventsBus.on(damageEventName, onDamage);
	emitHealthChanged();

	return {
		get current() { return current; },
		get maxHealth() { return maxHealth; },
		get isDead() { return hasDied; },
		get revision() { return revision; },
		getSnapshot() {
			return Object.freeze({ current, max: maxHealth, ratio: Number((current / maxHealth).toFixed(4)), defeated: hasDied, revision });
		},
		heal(amount: number) {
			if (!Number.isFinite(amount) || !(amount > 0)) return;
			const previous = current;
			const next = Math.min(maxHealth, current + amount);
			if (next === current) return;
			current = next;
			revision += 1;
			if (current > 0) hasDied = false;
			emitHealthChanged({ previous, reason: 'heal' });
		},
		reset() {
			const previous = current;
			current = maxHealth;
			hasDied = false;
			revision += 1;
			emitHealthChanged({ previous, reason: 'reset' });
		},
		dispose(): void {
			eventsBus.off(damageEventName, onDamage);
		},
	};
}
