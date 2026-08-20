#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const npc = fs.readFileSync(new URL('../src/3d/gameplay/npc.js', import.meta.url), 'utf8');

const required = [
  ["perceptionIntent = 'patrol'", 'guard lifecycle must begin from patrol intent'],
  ["perceptionIntent = distanceToPlayer > combatEngageRadiusMeters ? 'chase' : 'combat'", 'visible acquired guard must choose chase/combat by engage radius'],
  ["perceptionIntent = 'observe'", 'partial suspicion must remain observe instead of instant combat'],
  ["perceptionIntent = lastKnownPlayer && investigationRemaining > 0 ? 'investigate' : 'patrol'", 'lost target must investigate before returning to patrol'],
  ["moveNpcToward(model, playerPosition, speedMps * 1.35", 'chase must use real movement instead of teleporting'],
  ["moveNpcToward(model, lastKnownPlayer, speedMps * 0.85", 'investigation must move toward last-known position'],
  ["releaseNpcGuardAlertOwnership", 'lost sight/dispose must release owned group alert'],
  ["simulationLod.step(delta, distanceToPlayer, urgent)", 'guard lifecycle must stay behind population LOD scheduler'],
  ["model.userData.npcPerception", 'runtime must expose observable perception telemetry'],
];
for (const [needle, message] of required) assert.ok(npc.includes(needle), message);

assert.equal(/Math\.random\s*\(/.test(npc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), false,
  'NPC gameplay lifecycle must remain deterministic and avoid Math.random()');
assert.equal(npc.includes('EditorMaterialStudio'), false, 'NPC runtime must never import editor-only material UI');

console.log('NPC_GUARD_LIFECYCLE_CONTRACT_PASS', JSON.stringify({
  lifecycle: ['patrol', 'observe', 'chase', 'combat', 'investigate', 'patrol'],
  deterministic: true,
  lodBounded: true,
  editorRuntimeSeparated: true,
}));
