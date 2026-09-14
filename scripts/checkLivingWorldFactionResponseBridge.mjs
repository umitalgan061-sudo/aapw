import assert from 'node:assert/strict';
import { planFactionResponseTick, applyFactionResponseTick, auditFactionResponsePlan } from '../src/3d/gameplay/livingWorldFactionResponseBridge.js';

const actors = [
  { id: 'guard-1', factionId: 'north-watch', canAttack: true },
  { id: 'wanted-1', factionId: 'raiders', fleeing: true },
  { id: 'citizen-1', factionId: 'north-watch' },
  { id: 'surrendered-1', factionId: 'raiders', surrendered: true },
];
const services = {
  factions: { getFactionIdForActor: (actor) => actor.factionId },
  reputation: { getReputation: (_actor, target) => target.id === 'wanted-1' || target.id === 'surrendered-1' ? -80 : 60 },
  diplomacy: { getRelation: (a, b) => a === b ? 'ally' : 'war' },
  law: { getWantedLevel: (target) => target.id === 'wanted-1' || target.id === 'surrendered-1' ? 90 : 0, canArrest: (_actor, target) => target.id !== 'surrendered-1' },
};
const input = { tick: 4, actors, observations: [
  { actorId: 'guard-1', targetId: 'wanted-1', confidence: 1 },
  { actorId: 'guard-1', targetId: 'citizen-1', confidence: 0.8 },
  { actorId: 'guard-1', targetId: 'surrendered-1', confidence: 1 },
  { actorId: 'guard-1', targetId: 'wanted-1', confidence: 0.2 },
], services };
const a = planFactionResponseTick(input);
const b = planFactionResponseTick({ ...input, observations: [...input.observations].reverse() });
assert.deepEqual(a, b);
assert.equal(a.decisions[0].action, 'assist');
assert.equal(a.decisions[1].action, 'engage');
assert.equal(a.decisions[2].action, 'pursue');
assert.equal(a.decisions[3].action, 'observe');
assert.equal(a.events.length, 2);
assert.deepEqual(a.events.map((event) => event.action), ['engage', 'pursue']);
assert.equal(auditFactionResponsePlan(a).ok, true);
const tampered = { ...a, fingerprint: 'tampered' };
assert.equal(auditFactionResponsePlan(tampered).ok, false);
const calls = [];
const applied = applyFactionResponseTick(a, { onDecision: (d) => calls.push(`decision:${d.action}`), emitWorldEvent: (e) => calls.push(`event:${e.action}`) });
assert.equal(applied.accepted, true);
assert.equal(applied.delegated, 4);
assert.equal(applied.emitted, 2);
assert.deepEqual(calls, ['decision:assist', 'decision:engage', 'decision:pursue', 'decision:observe', 'event:engage', 'event:pursue']);
const passive = applyFactionResponseTick(a);
assert.deepEqual(passive, { accepted: true, delegated: 0, emitted: 0, fingerprint: a.fingerprint });
console.log('FACTION_RESPONSE_BRIDGE_OK');
