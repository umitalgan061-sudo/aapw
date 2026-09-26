import { createPlayerCombatFrameDelta, isPlayerCombatFrameDelta } from '../src/3d/gameplay/playerCombatFrameDelta.js';

const first = { revision: 2, phase: 'windup', attack: { kind: 'light', comboStep: 1 }, movement: { grounded: true } };
const second = { revision: 3, phase: 'active', attack: { kind: 'light', comboStep: 2 }, movement: { grounded: true } };
const delta = createPlayerCombatFrameDelta(first, second);
if (!isPlayerCombatFrameDelta(delta)) throw new Error('delta shape invalid');
if (!delta.phaseChanged || !delta.attackChanged) throw new Error('expected combat edges missing');
if (delta.movementChanged || delta.equipmentChanged || delta.outcomeChanged) throw new Error('unexpected edges detected');
if (createPlayerCombatFrameDelta(first, second).transitionKey !== delta.transitionKey) throw new Error('transition key is not deterministic');
if (delta.toRevision < delta.fromRevision) throw new Error('revision regressed');
console.log(JSON.stringify({ ok: true, suite: 'player-combat-frame-delta', transitionKey: delta.transitionKey }));
