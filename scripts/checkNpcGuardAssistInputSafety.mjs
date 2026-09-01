#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/3d/gameplay/npc.js', import.meta.url), 'utf8');
function extractFunction(name) {
  const start = source.indexOf(`export function ${name}`);
  assert.ok(start >= 0, `${name} must remain exported from npc.js`);
  const openParen = source.indexOf('(', start);
  let parens = 0;
  let closeParen = -1;
  for (let i = openParen; i < source.length; i += 1) {
    if (source[i] === '(') parens += 1;
    else if (source[i] === ')' && --parens === 0) { closeParen = i; break; }
  }
  const brace = source.indexOf('{', closeParen);
  let depth = 0;
  let end = -1;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  assert.ok(end > brace, `${name} must have a complete body`);
  return source.slice(start, end).replace(/^export\s+/, '');
}
const evaluateNpcGuardAssistAlert = new Function(
  `${extractFunction('evaluateNpcGuardAssistAlert')}; return evaluateNpcGuardAssistAlert;`,
)();

const observer = Object.freeze({ x: 0, z: 0 });
const baseAlert = Object.freeze({
  groupId: 'winterfell-guard', sourceId: 'guard-a', revision: 7,
  sourcePosition: Object.freeze({ x: 3, z: 4 }),
  lastKnown: Object.freeze({ x: 6, z: 8 }),
});

const valid = evaluateNpcGuardAssistAlert({
  alert: baseAlert, observer, groupId: 'winterfell-guard', sourceId: 'guard-b', lastRevision: 6, assistRadiusMeters: 25,
});
assert.equal(valid.accepted, true);
assert.equal(valid.reason, 'assist');
assert.equal(valid.sourceDistanceMeters, 5);
assert.deepEqual(valid.lastKnown, { x: 6, z: 8 });

const stale = evaluateNpcGuardAssistAlert({
  alert: baseAlert, observer, groupId: 'winterfell-guard', sourceId: 'guard-b', lastRevision: 7, assistRadiusMeters: 25,
});
assert.equal(stale.accepted, false);
assert.equal(stale.reason, 'stale');

const self = evaluateNpcGuardAssistAlert({
  alert: baseAlert, observer, groupId: 'winterfell-guard', sourceId: 'guard-a', lastRevision: 0, assistRadiusMeters: 25,
});
assert.equal(self.accepted, false);
assert.equal(self.reason, 'self');

for (const sourcePosition of [{ x: Infinity, z: 0 }, { x: 0, z: Number.NaN }]) {
  const invalid = evaluateNpcGuardAssistAlert({
    alert: { ...baseAlert, sourcePosition }, observer, groupId: 'winterfell-guard', sourceId: 'guard-b', lastRevision: 0, assistRadiusMeters: 25,
  });
  assert.equal(invalid.accepted, false);
  assert.equal(invalid.reason, 'range');
  assert.equal(Number.isFinite(invalid.sourceDistanceMeters), false);
}

const outOfRange = evaluateNpcGuardAssistAlert({
  alert: { ...baseAlert, sourcePosition: { x: 30, z: 0 } }, observer,
  groupId: 'winterfell-guard', sourceId: 'guard-b', lastRevision: 0, assistRadiusMeters: 25,
});
assert.equal(outOfRange.accepted, false);
assert.equal(outOfRange.reason, 'range');

console.log('NPC_GUARD_ASSIST_INPUT_SAFETY_PASS');
