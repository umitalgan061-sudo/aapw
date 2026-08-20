#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/3d/gameplay/npc.js', import.meta.url), 'utf8');

assert.match(source, /const proximityUrgent = hasPlayerPosition && combatStanceEnabled/,
  'proximity urgency must remain an explicit NPC LOD input');
assert.match(source, /const pendingGuardAssist = perceptionEnabled && combatStanceEnabled && hasPlayerPosition/,
  'guard-assist acceptance must be evaluated before the LOD scheduler');
assert.match(source, /alert: guardAlertChannel\?\.groups\?\.get\?\.\(guardAlertGroupId\)/,
  'assist preflight must read the existing shared settlement alert channel');
assert.match(source, /lastRevision: lastGuardAlertRevision/,
  'assist preflight must respect the receiver single-consume revision');
assert.match(source, /assistRadiusMeters: guardAssistRadiusMeters/,
  'assist preflight must keep the authored bounded group radius');
assert.match(source, /const urgent = proximityUrgent \|\| Boolean\(pendingGuardAssist\?\.accepted\)/,
  'only accepted assist may promote a distant guard to urgent simulation');
assert.match(source, /simulationLod\.step\(delta, distanceToPlayer, urgent\)/,
  'composed urgency must feed the existing NPC LOD scheduler');

const pendingIndex = source.indexOf('const pendingGuardAssist =');
const lodIndex = source.indexOf('simulationLod.step(delta, distanceToPlayer, urgent)');
const consumeIndex = source.indexOf('if (assist.accepted || assist.reason === \'self\') lastGuardAlertRevision');
assert.ok(pendingIndex >= 0 && lodIndex > pendingIndex,
  'assist preflight must happen before throttling can skip the NPC tick');
assert.ok(consumeIndex > lodIndex,
  'preflight must not consume the alert revision before a real simulation tick executes');
assert.equal(source.includes('setInterval('), false, 'assist wake must not add a second polling loop');
assert.equal(source.includes('requestAnimationFrame('), false, 'assist wake must stay inside the existing game-loop owner');

console.log('NPC_GUARD_ASSIST_LOD_WAKE_PASS', JSON.stringify({
  preflightBeforeLod: pendingIndex < lodIndex,
  revisionConsumedAfterRealTick: consumeIndex > lodIndex,
  sharedChannelReused: true,
  boundedAssistRadiusReused: true,
  secondSchedulerAdded: false,
}));
