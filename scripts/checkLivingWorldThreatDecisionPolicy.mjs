import assert from 'node:assert/strict';
import {
  decideLivingWorldThreat,
  summarizeLivingWorldThreatDecisions,
} from '../src/3d/gameplay/livingWorldThreatDecisionPolicy.js';

const attack = decideLivingWorldThreat({ currentState: 'detect', visualConfidence: 1, distanceMeters: 2, hasLineOfSight: true });
assert.equal(attack.nextState, 'attack');

const investigate = decideLivingWorldThreat({ currentState: 'patrol', hearingConfidence: 0.2, distanceMeters: 40 });
assert.equal(investigate.nextState, 'investigate');

const chase = decideLivingWorldThreat({ currentState: 'detect', visualConfidence: 0.8, stealth: 0, distanceMeters: 18, hasLineOfSight: false });
assert.equal(chase.nextState, 'chase');

const flee = decideLivingWorldThreat({ currentState: 'chase', visualConfidence: 1, distanceMeters: 4, healthRatio: 0.1, threatRatio: 1, allyCount: 0, hasLineOfSight: true });
assert.equal(flee.nextState, 'flee');

const repeatA = decideLivingWorldThreat({ currentState: 'patrol', hearingConfidence: 0.4, distanceMeters: 30, stealth: 0.1 });
const repeatB = decideLivingWorldThreat({ currentState: 'patrol', hearingConfidence: 0.4, distanceMeters: 30, stealth: 0.1 });
assert.deepEqual(repeatA, repeatB);

const summary = summarizeLivingWorldThreatDecisions([
  { actorId: 'wolf-1', currentState: 'roam', nextState: 'flee', reason: 'low-health-outnumbered' },
  { actorId: 'guard-1', currentState: 'detect', nextState: 'chase', reason: 'credible-threat-in-chase-range' },
], 1);
assert.equal(summary.count, 1);
assert.equal(summary.items[0].currentState, 'patrol');

console.log('living-world-threat-decision-policy: PASS');
