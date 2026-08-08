import assert from 'node:assert/strict';

const { EventBus } = await import('../src/3d/eventBus.js');
const { createHealthState } = await import('../src/3d/gameplay/health.js');

const eventsBus = new EventBus();
const changed = [];
const died = [];
const timeline = [];

const DAMAGE = 'test:damage';
const CHANGED = 'test:health-changed';
const DIED = 'test:died';

eventsBus.on(CHANGED, (payload) => {
	changed.push({ ...payload });
	timeline.push(`changed:${payload.current}`);
});
eventsBus.on(DIED, (payload) => {
	died.push({ ...payload });
	timeline.push(`died:${payload.sourceId ?? ''}`);
});

const health = createHealthState({
	eventsBus,
	maxHealth: 100,
	damageEventName: DAMAGE,
	healthChangedEventName: CHANGED,
	diedEventName: DIED,
});

assert.equal(health.current, 100);
assert.equal(health.maxHealth, 100);
assert.equal(health.isDead, false);
assert.deepEqual(changed, [{ current: 100, maxHealth: 100 }]);
assert.deepEqual(timeline, ['changed:100']);

// Malformed/non-positive damage must be a no-op and can never become accidental healing.
for (const payload of [undefined, {}, { amount: 0 }, { amount: -5 }, { amount: '10' }, { amount: Number.NaN }]) {
	eventsBus.emit(DAMAGE, payload);
}
assert.equal(health.current, 100);
assert.equal(changed.length, 1);
assert.equal(died.length, 0);

// Valid damage reduces health and preserves the public clamp contract.
eventsBus.emit(DAMAGE, { amount: 30, sourceId: 'dragon-a' });
assert.equal(health.current, 70);
assert.equal(health.isDead, false);
assert.deepEqual(changed.at(-1), { current: 70, maxHealth: 100 });

// Lethal overkill clamps to zero; health-changed must precede the single edge-triggered death event.
eventsBus.emit(DAMAGE, { amount: 999, sourceId: 'dragon-b' });
assert.equal(health.current, 0);
assert.equal(health.isDead, true);
assert.deepEqual(changed.at(-1), { current: 0, maxHealth: 100 });
assert.deepEqual(died, [{ sourceId: 'dragon-b' }]);
assert.deepEqual(timeline.slice(-2), ['changed:0', 'died:dragon-b']);

// Further damage while dead is ignored: no duplicate death and no duplicate health-change event.
const changedAfterDeath = changed.length;
eventsBus.emit(DAMAGE, { amount: 10, sourceId: 'dragon-c' });
assert.equal(changed.length, changedAfterDeath);
assert.equal(died.length, 1);

// Invalid healing is a no-op; real healing from zero re-arms death and remains capped by maxHealth.
for (const amount of [0, -1, '5', Number.NaN]) health.heal(amount);
assert.equal(health.current, 0);
health.heal(15);
assert.equal(health.current, 15);
assert.equal(health.isDead, false);
assert.deepEqual(changed.at(-1), { current: 15, maxHealth: 100 });

eventsBus.emit(DAMAGE, { amount: 15, sourceId: 'dragon-d' });
assert.equal(health.current, 0);
assert.equal(health.isDead, true);
assert.deepEqual(died, [{ sourceId: 'dragon-b' }, { sourceId: 'dragon-d' }]);

health.heal(500);
assert.equal(health.current, 100);
assert.equal(health.isDead, false);
const changedAtFull = changed.length;
health.heal(1);
assert.equal(changed.length, changedAtFull, 'healing an already-full state must not emit a redundant change');

// Respawn reset is intentionally unconditional: full health, death re-armed, and a fresh paint event.
health.reset();
assert.equal(health.current, 100);
assert.equal(health.isDead, false);
assert.equal(changed.length, changedAtFull + 1);
assert.deepEqual(changed.at(-1), { current: 100, maxHealth: 100 });

// Memory-leak contract: dispose detaches the damage subscription.
health.dispose();
const changedBeforeDisposedDamage = changed.length;
eventsBus.emit(DAMAGE, { amount: 40, sourceId: 'dragon-after-dispose' });
assert.equal(health.current, 100);
assert.equal(changed.length, changedBeforeDisposedDamage);
assert.equal(died.length, 2);

eventsBus.clear();

console.log('Health state contract PASS: initial paint, damage clamp, edge-triggered death, heal/reset re-arm and dispose cleanup preserved.');
