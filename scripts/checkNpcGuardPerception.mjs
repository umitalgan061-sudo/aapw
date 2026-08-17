#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NPC_CONFIG } from '../src/3d/gameplay/npcConfig.js';

const source = fs.readFileSync(new URL('../src/3d/gameplay/npc.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const marker = source.indexOf(`function ${name}`);
  const exportMarker = source.indexOf(`export function ${name}`);
  const start = exportMarker >= 0 ? exportMarker : marker;
  assert.ok(start >= 0, `${name} must exist in npc.js`);
  const openParen = source.indexOf('(', start);
  let parenDepth = 0;
  let closeParen = -1;
  for (let i = openParen; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    else if (source[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) { closeParen = i; break; }
    }
  }
  const brace = source.indexOf('{', closeParen);
  let depth = 0;
  let end = -1;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.ok(closeParen > openParen && end > brace, `${name} must have a complete body`);
  return source.slice(start, end).replace(/^export\s+/, '');
}

const evaluate = new Function(`${extractFunction('evaluateNpcGuardAwareness')}; return evaluateNpcGuardAwareness;`)();
const evaluateAssist = new Function(`${extractFunction('evaluateNpcGuardAssistAlert')}; return evaluateNpcGuardAssistAlert;`)();
const queryLos = new Function(`${extractFunction('queryNpcLineOfSight')}; return queryNpcLineOfSight;`)();

const observer = { x: 0, z: 0 };
assert.equal(evaluate({ observer, target: { x: 0, z: 8 }, yawRadians: 0, rangeMeters: 10 }).visible, true,
  'guard must see a target in the forward cone');
assert.equal(evaluate({ observer, target: { x: 0, z: -8 }, yawRadians: 0, rangeMeters: 10 }).visible, false,
  'guard must not have omnidirectional long-range vision');
assert.equal(evaluate({ observer, target: { x: 3, z: 0 }, yawRadians: 0, rangeMeters: 10 }).reason, 'peripheral',
  'close targets must retain bounded 360-degree awareness');
assert.equal(evaluate({ observer, target: { x: 0, z: 5 }, yawRadians: 0, rangeMeters: 10, lineOfSight: false }).reason, 'occluded',
  'blocked LOS must defeat vision');
assert.equal(evaluate({ observer, target: { x: 0, z: 11 }, yawRadians: 0, rangeMeters: 10 }).reason, 'range',
  'vision must stay range-bounded');

const radius = 8;
const insideBoundary = { x: Math.sin(59.9 * Math.PI / 180) * radius, z: Math.cos(59.9 * Math.PI / 180) * radius };
const outsideBoundary = { x: Math.sin(60.1 * Math.PI / 180) * radius, z: Math.cos(60.1 * Math.PI / 180) * radius };
assert.equal(evaluate({ observer, target: insideBoundary, yawRadians: 0, rangeMeters: 10 }).visible, true,
  'target immediately inside the authored 60-degree half-angle must remain visible');
assert.equal(evaluate({ observer, target: outsideBoundary, yawRadians: 0, rangeMeters: 10 }).reason, 'behind',
  'target immediately outside the authored FOV must remain rejected');

const clearCollider = { resolveXZ: (x, z) => ({ x, z }) };
const clear = queryLos(clearCollider, observer, { x: 0, z: 1000 });
assert.equal(clear.clear, true);
assert.equal(clear.samples, 32, 'very long clear LOS must consume exactly the bounded 32-probe ceiling');
let blockedProbes = 0;
const wallCollider = {
  resolveXZ(x, z) {
    blockedProbes += 1;
    return z >= 4 && z <= 6 ? { x: x + 1, z } : { x, z };
  },
};
const blocked = queryLos(wallCollider, observer, { x: 0, z: 10 });
assert.equal(blocked.clear, false, 'collider displacement must block guard LOS');
assert.ok(blocked.samples <= 32 && blockedProbes <= 32, 'blocked LOS must also stay bounded');
assert.ok(blocked.samples < clear.samples, 'occluded LOS must early-exit instead of burning the full probe budget');

const assistAlert = {
  revision: 4,
  groupId: 'stannis',
  sourceId: 'leader',
  sourcePosition: { x: 24, z: 0 },
  lastKnown: { x: 0, z: 8 },
};
const assist = evaluateAssist({ alert: assistAlert, observer, groupId: 'stannis', sourceId: 'wingman', lastRevision: 3, assistRadiusMeters: 25 });
assert.equal(assist.accepted, true, 'nearby same-settlement guard must accept a fresh visual alert across authored guard spacing');
assert.equal(assist.reason, 'assist');
assert.deepEqual(assist.lastKnown, { x: 0, z: 8 });
assert.equal(evaluateAssist({ alert: assistAlert, observer, groupId: 'stannis', sourceId: 'leader', lastRevision: 3, assistRadiusMeters: 25 }).reason, 'self',
  'publisher must not consume its own alert');
assert.equal(evaluateAssist({ alert: assistAlert, observer, groupId: 'stannis', sourceId: 'wingman', lastRevision: 4, assistRadiusMeters: 25 }).reason, 'stale',
  'each alert revision must be consumed at most once');
assert.equal(evaluateAssist({ alert: assistAlert, observer, groupId: 'cersei', sourceId: 'wingman', lastRevision: 3, assistRadiusMeters: 25 }).accepted, false,
  'alerts must not cross settlement groups');
assert.equal(evaluateAssist({ alert: assistAlert, observer: { x: 50, z: 0 }, groupId: 'stannis', sourceId: 'wingman', lastRevision: 3, assistRadiusMeters: 25 }).reason, 'range',
  'assist propagation must stay radius-bounded');

const spawnGroups = new Map();
for (const spawn of NPC_CONFIG.SPAWNS) {
  const group = spawnGroups.get(spawn.seatId) ?? [];
  group.push(spawn);
  spawnGroups.set(spawn.seatId, group);
}
let authoredAssistPair = null;
for (const [seatId, group] of spawnGroups) {
  for (let i = 0; i < group.length; i += 1) {
    for (let j = i + 1; j < group.length; j += 1) {
      const distance = Math.hypot(group[i].offsetXMeters - group[j].offsetXMeters, group[i].offsetZMeters - group[j].offsetZMeters);
      if (distance <= 25) authoredAssistPair = { seatId, sourceId: group[i].id, receiverId: group[j].id, distance };
    }
  }
}
assert.ok(authoredAssistPair, 'at least one canonical same-seat guard pair must fit inside the shipped assist radius');
assert.ok(authoredAssistPair.distance <= 25, 'authored pair distance must remain bounded by the 25m assist radius');

assert.match(source, /perceptionEnabled = false/, 'direct createNPC consumers must keep legacy behavior by default');
assert.match(source, /perceptionEnabled: true/, 'configured shipped NPCs must explicitly opt into perception');
assert.match(source, /simulationLodEnabled: true/, 'configured guards must preserve merged population LOD');
assert.match(source, /heard = !awareness\.visible/, 'hearing must not masquerade as visual detection');
assert.match(source, /perceptionIntent = distanceToPlayer > combatEngageRadiusMeters \? 'chase' : 'combat'/,
  'fully acquired visible guards must chase outside engage radius and only enter combat inside it');
assert.match(source, /moveNpcToward\(model, playerPosition, speedMps \* 1\.35/,
  'chase must move the established NPC controller toward the current visible player');
assert.match(source, /combatEngageRadiusMeters = combatStanceEnabled[\s\S]*Math\.max\(1\.5, Math\.min\(3\.5/,
  'guard engage radius must remain bounded inside the broader perception radius');
assert.match(source, /guardAssistRadiusMeters = combatStanceEnabled[\s\S]*Math\.max\(12, Math\.min\(28/,
  'guard assist radius must stay bounded while spanning authored same-seat guard spacing');
assert.match(source, /guardAlertChannel = \{ nextRevision: 1, groups: new Map\(\) \}/,
  'configured population must share one bounded guard alert channel');
assert.match(source, /guardAlertGroupId: spawn\.seatId/,
  'configured assist groups must use canonical settlement seat identity');
assert.match(source, /if \(!awareness\.visible && assist\.accepted && assist\.lastKnown\)/,
  'assist must only seed investigation when the receiving guard lacks its own visual acquisition');
assert.match(source, /reason: assisted \? 'assist' : heard \? 'hearing'/,
  'assist telemetry must remain distinct from hearing and visual sensing');
assert.match(source, /engageRadiusMeters:/, 'runtime telemetry must expose the chase-to-combat boundary');
assert.match(source, /moveNpcToward\(model, lastKnownPlayer/, 'lost contact must fall back to last-known investigation');
assert.match(source, /moveNpcToward\(model, homePosition/, 'static guards must return home after investigation expires');
assert.match(source, /\n\t\t\tgroundCollider,\n\t\t\tplayerCollider,\n\t\t\twalkAnimationUrl:/,
  'configured guards must receive canonical ground and collision context even without patrol waypoints');
assert.match(source, /lineOfSightSamples/, 'runtime telemetry must expose bounded LOS work');
assert.equal(source.includes('EditorMaterialStudio'), false, 'NPC runtime must not import editor/DOM material UI');

console.log('NPC_GUARD_PERCEPTION_PASS', JSON.stringify({
  fieldOfViewDegrees: 120,
  fieldOfViewBoundaryLocked: true,
  losSampleBudget: 32,
  losOcclusionEarlyExit: true,
  hearingCannotCombatDirectly: true,
  chaseBeforeCombat: true,
  engageRadiusBounded: true,
  assistRadiusMeters: 25,
  assistRadiusBounded: true,
  assistSameSettlementOnly: true,
  assistRevisionSingleConsume: true,
  assistCannotCombatDirectly: true,
  authoredAssistPair,
  configuredPerceptionOptIn: true,
  staticReturnHome: true,
  canonicalColliderContext: true,
  populationLodPreserved: true,
}));
