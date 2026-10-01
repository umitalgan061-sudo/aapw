import assert from 'node:assert/strict';
import { createPlayerCombatImpactWindowGate, resolvePlayerCombatImpactWindow } from '../src/3d/gameplay/playerCombatImpactWindow.js';

const light = resolvePlayerCombatImpactWindow({ phase: 'active', attackKind: 'light', progress: 0.4, targetId: 'wolf-1' });
assert.equal(light.hitboxActive, true);
assert.equal(light.canConfirmHit, true);
assert.equal(light.hurtboxActive, true);

const heavy = resolvePlayerCombatImpactWindow({ phase: 'windup', attackKind: 'heavy', progress: 0.3, targetId: 'wolf-1' });
assert.equal(heavy.hitboxActive, false);
assert.equal(heavy.canConfirmHit, false);

const archery = resolvePlayerCombatImpactWindow({ phase: 'active', attackKind: 'archery', progress: 0.8, targetId: 'boar-2' }, { archery: { start: 0.7, end: 0.85 } });
assert.equal(archery.hitboxActive, true);
assert.equal(archery.canConfirmHit, true);

const missingTarget = resolvePlayerCombatImpactWindow({ phase: 'active', attackKind: 'light', progress: 0.4 });
assert.equal(missingTarget.hitboxActive, true);
assert.equal(missingTarget.canConfirmHit, false);

const defeated = resolvePlayerCombatImpactWindow({ phase: 'defeated', attackKind: 'light', progress: 0.4, targetId: 'wolf-1' });
assert.equal(defeated.hitboxActive, false);
assert.equal(defeated.hurtboxActive, false);

const gate = createPlayerCombatImpactWindowGate({ maxHistory: 2 });
const first = gate.evaluate({ phase: 'active', attackKind: 'light', progress: 0.4, targetId: 'wolf-1' });
first.window.start = 99;
assert.equal(gate.snapshot().history[0].window.start, 0.34);
gate.evaluate({ phase: 'active', attackKind: 'light', progress: 0.5, targetId: 'wolf-1' });
gate.evaluate({ phase: 'recovery', attackKind: 'light', progress: 0.9, targetId: 'wolf-1' });
assert.equal(gate.snapshot().count, 2);
gate.dispose();
assert.equal(gate.evaluate({ phase: 'active', attackKind: 'light', progress: 0.4, targetId: 'wolf-1' }).disposed, true);

console.log('player combat impact window checks passed');
