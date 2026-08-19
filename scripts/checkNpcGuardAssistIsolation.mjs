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

const stannisAlert = Object.freeze({
  revision: 11,
  groupId: 'stannis',
  sourceId: 'stannis-guard-1',
  sourcePosition: Object.freeze({ x: 10, z: 5 }),
  lastKnown: Object.freeze({ x: 14, z: 8 }),
});

const crossSettlement = evaluateAssist({
  alert: stannisAlert,
  observer: { x: 11, z: 5 },
  groupId: 'cersei',
  sourceId: 'cersei-guard-1',
  lastRevision: 0,
  assistRadiusMeters: 25,
});
assert.equal(crossSettlement.accepted, false, 'an alert from another settlement must never be accepted');
assert.equal(crossSettlement.reason, 'stale', 'cross-settlement alerts must fail before spatial acceptance');
assert.equal(crossSettlement.revision, 0, 'foreign settlement revision must not advance receiver state');

const sameSettlement = evaluateAssist({
  alert: stannisAlert,
  observer: { x: 11, z: 5 },
  groupId: 'stannis',
  sourceId: 'stannis-guard-2',
  lastRevision: 0,
  assistRadiusMeters: 25,
});
assert.equal(sameSettlement.accepted, true, 'same-settlement receiver inside radius must accept a fresh alert');
assert.equal(sameSettlement.revision, 11);
assert.deepEqual(sameSettlement.lastKnown, { x: 14, z: 8 });

const replay = evaluateAssist({
  alert: stannisAlert,
  observer: { x: 11, z: 5 },
  groupId: 'stannis',
  sourceId: 'stannis-guard-2',
  lastRevision: 11,
  assistRadiusMeters: 25,
});
assert.equal(replay.accepted, false, 'same revision must be single-consume');
assert.equal(replay.reason, 'stale');

const newerAlert = Object.freeze({
  ...stannisAlert,
  revision: 12,
  sourcePosition: Object.freeze({ x: 12, z: 5 }),
  lastKnown: Object.freeze({ x: 16, z: 8 }),
});
const newer = evaluateAssist({
  alert: newerAlert,
  observer: { x: 11, z: 5 },
  groupId: 'stannis',
  sourceId: 'stannis-guard-2',
  lastRevision: 11,
  assistRadiusMeters: 25,
});
assert.equal(newer.accepted, true, 'a strictly newer revision must remain consumable');
assert.equal(newer.revision, 12);

const self = evaluateAssist({
  alert: newerAlert,
  observer: { x: 12, z: 5 },
  groupId: 'stannis',
  sourceId: 'stannis-guard-1',
  lastRevision: 0,
  assistRadiusMeters: 25,
});
assert.equal(self.accepted, false, 'publisher must never assist itself');
assert.equal(self.reason, 'self');
assert.equal(self.revision, 12, 'publisher self-observation may consume its own current revision');

const invalidSource = evaluateAssist({
  alert: Object.freeze({ revision: 13, groupId: 'stannis', sourceId: 'stannis-guard-1', sourcePosition: null, lastKnown: null }),
  observer: { x: 12, z: 5 },
  groupId: 'stannis',
  sourceId: 'stannis-guard-2',
  lastRevision: 12,
  assistRadiusMeters: 25,
});
assert.equal(invalidSource.accepted, false);
assert.equal(invalidSource.reason, 'invalid', 'malformed alerts must fail closed');

assert.match(source, /guardAlertGroupId: spawn\.seatId/,
  'configured guards must keep settlement seat as the canonical assist partition');
assert.match(source, /guardAlertChannel = \{ nextRevision: 1, groups: new Map\(\) \}/,
  'configured NPCs must keep one bounded shared alert channel');
assert.equal(source.includes('EditorMaterialStudio'), false,
  'NPC runtime must remain free of editor/DOM material UI imports');

console.log('NPC_GUARD_ASSIST_ISOLATION_PASS', JSON.stringify({
  crossSettlementBlocked: true,
  foreignRevisionNotConsumed: true,
  sameSettlementAccepted: true,
  replayBlocked: true,
  newerRevisionAccepted: true,
  selfRelayBlocked: true,
  malformedAlertFailsClosed: true,
}));
