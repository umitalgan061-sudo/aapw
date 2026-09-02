#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const npc = fs.readFileSync(new URL('../src/3d/gameplay/npc.js', import.meta.url), 'utf8');

const required = [
  ["perceptionIntent = 'patrol'", 'guard lifecycle must begin from patrol intent'],
  ["perceptionIntent = distanceToPlayer > combatEngageRadiusMeters ? 'chase' : 'combat'", 'visible acquired guard must choose chase/combat by engage radius'],
  ["perceptionIntent = 'observe'", 'partial suspicion must remain observe instead of instant combat'],
  ["perceptionIntent = 'investigate'", 'lost target must investigate before route recovery'],
  ["perceptionIntent = returningToRoute ? 'return' : 'patrol'", 'expired investigation must explicitly return to route before patrol'],
  ["perceptionIntent === 'return'", 'route recovery must have a shipped movement state'],
  ["moveNpcToward(model, playerPosition, speedMps * 1.35", 'chase must use real movement instead of teleporting'],
  ["moveNpcToward(model, lastKnownPlayer, speedMps * 0.85", 'investigation must move toward last-known position'],
  ["releaseNpcGuardAlertOwnership", 'lost sight/dispose must release owned group alert'],
  ["simulationLod.step(delta, distanceToPlayer, urgent)", 'guard lifecycle must stay behind population LOD scheduler'],
  ["model.userData.npcPerception", 'runtime must expose observable perception telemetry'],
];
for (const [needle, message] of required) assert.ok(npc.includes(needle), message);

function extractExportedFunction(name) {
  const start = npc.indexOf(`export function ${name}`);
  assert.ok(start >= 0, `${name} must remain exported from npc.js`);
  const openParen = npc.indexOf('(', start);
  let parens = 0;
  let closeParen = -1;
  for (let i = openParen; i < npc.length; i += 1) {
    if (npc[i] === '(') parens += 1;
    else if (npc[i] === ')' && --parens === 0) { closeParen = i; break; }
  }
  const brace = npc.indexOf('{', closeParen);
  let depth = 0;
  let end = -1;
  for (let i = brace; i < npc.length; i += 1) {
    if (npc[i] === '{') depth += 1;
    else if (npc[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  assert.ok(end > brace, `${name} must have a complete body`);
  return npc.slice(start, end).replace(/^export\s+/, '');
}

const evaluateNpcGuardAssistAlert = new Function(
  `${extractExportedFunction('evaluateNpcGuardAssistAlert')}; return evaluateNpcGuardAssistAlert;`,
)();
const observer = Object.freeze({ x: 0, z: 0 });
const baseAlert = Object.freeze({
  groupId: 'winterfell-guard', sourceId: 'guard-a', revision: 7,
  sourcePosition: Object.freeze({ x: 3, z: 4 }),
  lastKnown: Object.freeze({ x: 6, z: 8 }),
});
const evaluate = (alert, overrides = {}) => evaluateNpcGuardAssistAlert({
  alert, observer, groupId: 'winterfell-guard', sourceId: 'guard-b',
  lastRevision: 6, assistRadiusMeters: 25, ...overrides,
});

const validAssist = evaluate(baseAlert);
assert.equal(validAssist.accepted, true);
assert.equal(validAssist.reason, 'assist');
assert.equal(validAssist.revision, 7, 'receiver must consume the exact published revision');
assert.equal(validAssist.sourceId, 'guard-a', 'receiver must retain the publishing guard identity');
assert.equal(validAssist.sourceDistanceMeters, 5);
assert.deepEqual(validAssist.lastKnown, { x: 6, z: 8 });
assert.notEqual(validAssist.lastKnown, baseAlert.lastKnown, 'receiver must copy shared alert last-known state');
validAssist.lastKnown.x = 99;
assert.equal(baseAlert.lastKnown.x, 6, 'receiver-local mutation must not alter the shared frozen alert');
assert.equal(evaluate(baseAlert, { lastRevision: 7 }).reason, 'stale');
assert.equal(evaluate(baseAlert, { sourceId: 'guard-a', lastRevision: 0 }).reason, 'self');
const crossGroup = evaluate({ ...baseAlert, groupId: 'dreadfort-guard' }, { lastRevision: 0 });
assert.equal(crossGroup.accepted, false);
assert.equal(crossGroup.reason, 'stale');
for (const revision of [Infinity, Number.NaN, 7.5, 0, -1]) {
  const invalidRevision = evaluate({ ...baseAlert, revision }, { lastRevision: 0 });
  assert.equal(invalidRevision.accepted, false);
  assert.equal(invalidRevision.reason, 'stale');
}
for (const lastRevision of [Infinity, Number.NaN]) {
  const invalidState = evaluate(baseAlert, { lastRevision });
  assert.equal(invalidState.accepted, false);
  assert.equal(invalidState.reason, 'stale');
}
for (const sourcePosition of [{ x: Infinity, z: 0 }, { x: 0, z: Number.NaN }]) {
  const invalid = evaluate({ ...baseAlert, sourcePosition }, { lastRevision: 0 });
  assert.equal(invalid.accepted, false);
  assert.equal(invalid.reason, 'range');
  assert.equal(Number.isFinite(invalid.sourceDistanceMeters), false);
}
for (const invalidObserver of [{ x: Infinity, z: 0 }, { x: 0, z: Number.NaN }]) {
  const invalid = evaluateNpcGuardAssistAlert({
    alert: baseAlert,
    observer: invalidObserver,
    groupId: 'winterfell-guard',
    sourceId: 'guard-b',
    lastRevision: 0,
    assistRadiusMeters: 25,
  });
  assert.equal(invalid.accepted, false);
  assert.equal(invalid.reason, 'range');
  assert.equal(Number.isFinite(invalid.sourceDistanceMeters), false);
}
for (const assistRadiusMeters of [0, -1, Number.NaN]) {
  const invalidRange = evaluate(baseAlert, { lastRevision: 0, assistRadiusMeters });
  assert.equal(invalidRange.accepted, false);
  assert.equal(invalidRange.reason, 'invalid');
}
for (const lastKnown of [{ x: Infinity, z: 0 }, { x: 0, z: Number.NaN }]) {
  const invalidTarget = evaluate({ ...baseAlert, lastKnown }, { lastRevision: 0 });
  assert.equal(invalidTarget.accepted, false);
  assert.equal(invalidTarget.reason, 'invalid');
}
const missingSource = evaluate({ ...baseAlert, sourcePosition: null }, { lastRevision: 0 });
assert.equal(missingSource.accepted, false);
assert.equal(missingSource.reason, 'invalid');
assert.equal(evaluate({ ...baseAlert, sourcePosition: { x: 30, z: 0 } }, { lastRevision: 0 }).reason, 'range');

assert.equal(/Math\.random\s*\(/.test(npc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), false,
  'NPC gameplay lifecycle must remain deterministic and avoid Math.random()');
assert.equal(npc.includes('EditorMaterialStudio'), false, 'NPC runtime must never import editor-only material UI');

console.log('NPC_GUARD_LIFECYCLE_CONTRACT_PASS', JSON.stringify({
  lifecycle: ['patrol', 'observe', 'chase', 'combat', 'investigate', 'return', 'patrol'],
  deterministic: true,
  lodBounded: true,
  guardAssistInputSafe: true,
  editorRuntimeSeparated: true,
}));
