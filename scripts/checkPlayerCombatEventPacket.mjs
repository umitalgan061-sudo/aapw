import assert from 'node:assert/strict';
import { buildPlayerCombatEventPacket, isPlayerCombatEventPacket, normalizePlayerCombatEvent } from '../src/3d/gameplay/playerCombatEventPacket.ts';

const attack = normalizePlayerCombatEvent('attack-window', { serial: 4, phase: 'active-start', kind: 'heavy', comboStep: 2, active: true, stamina: 84, reachMeters: 2.05, damageScale: 1.65, position: { x: 1, y: 0, z: 2 }, facing: { x: 0.6, z: 0.8 } });
const feedback = normalizePlayerCombatEvent('combat-feedback', { serial: 7, outcome: 'staggered', rawAmount: 10, appliedAmount: 8, blockedAmount: 2, stamina: 70, poise: 0, state: 'hit-stagger', position: { x: 1, y: 0, z: 2 } });
const packetA = buildPlayerCombatEventPacket([
  { eventKind: 'attack-window', payload: attack },
  { eventKind: 'combat-feedback', payload: feedback },
]);
const packetB = buildPlayerCombatEventPacket([
  { eventKind: 'attack-window', payload: { ...attack, facing: { x: 60, z: 80 } } },
  { eventKind: 'combat-feedback', payload: feedback },
]);
assert.equal(packetA.replayKey, packetB.replayKey);
assert.equal(packetA.activeAttack, true);
assert.equal(packetA.dominantOutcome, 'staggered');
assert.equal(isPlayerCombatEventPacket(packetA), true);
assert.equal(Object.isFrozen(packetA), true);
assert.equal(Object.isFrozen(packetA.events), true);
assert.equal(normalizePlayerCombatEvent('unknown', {}).kind, 'none');
assert.equal(buildPlayerCombatEventPacket([null, { eventKind: 'unknown', payload: {} }]).eventCount, 0);
assert.equal(isPlayerCombatEventPacket({}), false);
console.log('player combat event packet proof: PASS');
