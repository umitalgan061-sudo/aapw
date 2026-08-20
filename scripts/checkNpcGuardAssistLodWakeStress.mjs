#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/3d/gameplay/npc.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const marker = `export function ${name}`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${name} must remain exported from npc.js`);
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
  assert.ok(end > brace, `${name} must have a complete body`);
  return source.slice(start, end).replace(/^export\s+/, '');
}

const evaluateAssist = new Function(
  `${extractFunction('evaluateNpcGuardAssistAlert')}; return evaluateNpcGuardAssistAlert;`,
)();

const clampSimulationDelta = new Function(
  `${source.slice(source.indexOf('function clampSimulationDelta'), source.indexOf('function queryNpcLineOfSight'))}; return clampSimulationDelta;`,
)();
const deterministicNpcPhaseSeconds = new Function(
  `${extractFunction('deterministicNpcPhaseSeconds')}; return deterministicNpcPhaseSeconds;`,
)();
const createLod = new Function(
  'clampSimulationDelta',
  'deterministicNpcPhaseSeconds',
  `${extractFunction('createNpcSimulationLod')}; return createNpcSimulationLod;`,
)(clampSimulationDelta, deterministicNpcPhaseSeconds);

const frame = 1 / 60;
const playerDistance = 500;
const groupId = 'stannis';
const receiverId = 'stannis-guard-2';
const assistRadiusMeters = 25;
const receiver = Object.freeze({ x: 25, z: 0 });

function makeAlert(revision, overrides = {}) {
  return Object.freeze({
    revision,
    groupId,
    sourceId: 'stannis-guard-1',
    sourcePosition: Object.freeze({ x: 0, z: 0 }),
    lastKnown: Object.freeze({ x: 3, z: 2 }),
    ...overrides,
  });
}

const exactBoundary = evaluateAssist({
  alert: makeAlert(1), observer: receiver, groupId, sourceId: receiverId,
  lastRevision: 0, assistRadiusMeters,
});
assert.equal(exactBoundary.accepted, true, 'assist exactly on the authored radius must be accepted');
assert.equal(exactBoundary.sourceDistanceMeters, 25);

const epsilonOutside = evaluateAssist({
  alert: makeAlert(2), observer: { x: 25.001, z: 0 }, groupId, sourceId: receiverId,
  lastRevision: 1, assistRadiusMeters,
});
assert.equal(epsilonOutside.accepted, false, 'assist outside the authored radius must not wake the receiver');
assert.equal(epsilonOutside.reason, 'range');

const wrongSettlement = evaluateAssist({
  alert: makeAlert(3), observer: receiver, groupId: 'cersei', sourceId: 'cersei-guard-2',
  lastRevision: 0, assistRadiusMeters,
});
assert.equal(wrongSettlement.accepted, false, 'foreign settlement alarm must never become LOD urgency');

const selfAlert = evaluateAssist({
  alert: makeAlert(4), observer: receiver, groupId, sourceId: 'stannis-guard-1',
  lastRevision: 0, assistRadiusMeters,
});
assert.equal(selfAlert.accepted, false, 'publisher must not wake itself through the assist channel');
assert.equal(selfAlert.reason, 'self');

const lod = createLod({ id: receiverId });
for (let i = 0; i < 90; i += 1) lod.step(frame, playerDistance, false);
assert.equal(lod.tier, 'distant', 'receiver fixture must begin on distant cadence');

let lastRevision = 0;
let wakeCount = 0;
let staleReplayFrames = 0;
for (let revision = 10; revision < 18; revision += 1) {
  const alert = makeAlert(revision, {
    lastKnown: Object.freeze({ x: 3 + revision * 0.01, z: 2 }),
  });
  const fresh = evaluateAssist({
    alert, observer: receiver, groupId, sourceId: receiverId,
    lastRevision, assistRadiusMeters,
  });
  assert.equal(fresh.accepted, true, `fresh revision ${revision} must be accepted once`);
  const wakeStep = lod.step(frame, playerDistance, fresh.accepted);
  assert.equal(lod.tier, 'urgent', `fresh revision ${revision} must immediately wake distant LOD`);
  assert.equal(wakeStep, frame, 'urgent wake must use the current bounded frame delta');
  wakeCount += 1;
  lastRevision = fresh.revision;

  for (let replay = 0; replay < 120; replay += 1) {
    const stale = evaluateAssist({
      alert, observer: receiver, groupId, sourceId: receiverId,
      lastRevision, assistRadiusMeters,
    });
    assert.equal(stale.accepted, false, `revision ${revision} replay must remain single-consume`);
    assert.equal(stale.reason, 'stale');
    lod.step(frame, playerDistance, stale.accepted);
    staleReplayFrames += 1;
    assert.notEqual(lod.tier, 'urgent', 'stale replay must never pin a distant guard at full-rate urgency');
  }
}

assert.equal(wakeCount, 8, 'fixture must prove repeated newer revisions can each wake exactly once');
assert.equal(staleReplayFrames, 960, 'fixture must exercise a sustained replay storm');

const malformedCases = [
  null,
  Object.freeze({ revision: 99, groupId, sourceId: 'stannis-guard-1', sourcePosition: null, lastKnown: null }),
  Object.freeze({ revision: 100, groupId, sourceId: 'stannis-guard-1', sourcePosition: { x: NaN, z: 0 }, lastKnown: { x: 0, z: 0 } }),
];
for (const alert of malformedCases) {
  const result = evaluateAssist({
    alert, observer: receiver, groupId, sourceId: receiverId,
    lastRevision, assistRadiusMeters,
  });
  assert.equal(result.accepted, false, 'malformed alert must fail closed and never create urgency');
}

assert.equal(source.includes('setInterval('), false, 'stress hardening must not introduce a second polling scheduler');
assert.equal(source.includes('EditorMaterialStudio'), false, 'NPC runtime must stay free of editor/DOM material imports');

console.log('NPC_GUARD_ASSIST_LOD_WAKE_STRESS_PASS', JSON.stringify({
  exactRadiusAccepted: true,
  epsilonOutsideRejected: true,
  settlementIsolation: true,
  selfWakeBlocked: true,
  freshWakeCount: wakeCount,
  staleReplayFrames,
  staleReplayNeverUrgent: true,
  malformedAlertsFailClosed: true,
}));
