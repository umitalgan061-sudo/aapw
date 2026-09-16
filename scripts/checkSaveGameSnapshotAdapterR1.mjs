#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  applyRestorePlan,
  buildGameplaySnapshot,
  createRestorePlan,
  summarizeGameplaySnapshot,
  validateGameplaySnapshot,
} from '../src/3d/persistence/saveGameSnapshotAdapter.js';

const source = {
  seed: 77,
  unexpectedRenderer: { gl: true },
  player: {
    id: 'hero',
    position: { x: 1.23456, y: 4.56789, z: -8.76543 },
    health: 999999,
    stamina: -5,
    poise: 12,
    level: 7,
    experience: 12345,
    inventory: Array.from({ length: 200 }, (_, index) => ({ id: `item-${index}`, quantity: 2 })),
    equipment: { weapon: { id: 'sword', renderer: {} }, ring: 'wolf-ring' },
  },
  world: {
    day: 3,
    timeOfDayMinutes: 1500,
    currentSettlementId: 'winterfell',
    visitedSettlementIds: ['winterfell', 'castle-black'],
    flags: { gateOpen: true, reputation: 2, domNode: {} },
  },
  quests: Array.from({ length: 160 }, (_, index) => ({ id: `quest-${index}`, state: 'active', progress: index / 100 })),
  recentEvents: Array.from({ length: 50 }, (_, index) => ({ id: `event-${index}`, type: 'combat', at: index })),
};

function runBuildAndBounds() {
  const snapshot = buildGameplaySnapshot(source, { capturedAtMs: 1000 });
  assert.equal(snapshot.schema, 'aapw.gameplay-snapshot');
  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.player.id, 'hero');
  assert.deepEqual(snapshot.player.position, { x: 1.235, y: 4.568, z: -8.765 });
  assert.equal(snapshot.player.health, 100000);
  assert.equal(snapshot.player.stamina, 0);
  assert.equal(snapshot.player.inventory.length, 128);
  assert.equal(snapshot.quests.length, 128);
  assert.equal(snapshot.recentEvents.length, 32);
  assert.equal('unexpectedRenderer' in snapshot, false);
  assert.equal(snapshot.player.equipment.weapon, 'sword');
  assert.equal(snapshot.world.timeOfDayMinutes, 1439);
  assert.equal(validateGameplaySnapshot(snapshot).valid, true);
}

function runSeedAndVersionGuards() {
  const snapshot = buildGameplaySnapshot({ seed: 77, player: {}, world: {} });
  assert.equal(validateGameplaySnapshot(snapshot, { expectedSeed: 77 }).valid, true);
  assert.equal(validateGameplaySnapshot(snapshot, { expectedSeed: 99 }).reason, 'SEED');
  assert.equal(validateGameplaySnapshot({ ...snapshot, version: 999 }).reason, 'VERSION');
  assert.equal(validateGameplaySnapshot({ ...snapshot, schema: 'other' }).reason, 'SCHEMA');
}

function runRestorePlan() {
  const snapshot = buildGameplaySnapshot(source, { capturedAtMs: 1000 });
  const plan = createRestorePlan(snapshot, { expectedSeed: 77 });
  assert.equal(plan.ok, true);
  assert.equal(plan.seed, 77);
  const calls = [];
  const applied = applyRestorePlan(plan, {
    player(value, seed) { calls.push(['player', value.level, seed]); },
    world(value) { calls.push(['world', value.day]); },
    quests(value) { calls.push(['quests', value.length]); },
    recentEvents(value) { calls.push(['events', value.length]); },
  });
  assert.deepEqual(calls, [['player', 7, 77], ['world', 3], ['quests', 128], ['events', 32]]);
  assert.equal(applied.applied, 4);
}

function runHandlerFailure() {
  const snapshot = buildGameplaySnapshot({ seed: 1, player: {}, world: {} });
  const plan = createRestorePlan(snapshot);
  const result = applyRestorePlan(plan, { player() { throw new Error('apply-failed'); } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'apply-failed');
  assert.equal(result.applied, 0);
}

function runSummary() {
  const snapshot = buildGameplaySnapshot(source);
  const summary = summarizeGameplaySnapshot(snapshot);
  assert.equal(summary.valid, true);
  assert.equal(summary.seed, 77);
  assert.equal(summary.inventoryItems, 128);
  assert.equal(summary.questCount, 128);
  assert.equal(summary.recentEvents, 32);
  assert.equal(summarizeGameplaySnapshot({}).valid, false);
}

runBuildAndBounds();
runSeedAndVersionGuards();
runRestorePlan();
runHandlerFailure();
runSummary();
console.log('Save gameplay snapshot adapter R1 acceptance passed.');
