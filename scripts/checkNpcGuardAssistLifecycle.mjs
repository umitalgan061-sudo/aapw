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
const releaseOwnership = new Function(
  `${extractFunction('releaseNpcGuardAlertOwnership')}; return releaseNpcGuardAlertOwnership;`,
)();

const alert = Object.freeze({
  revision: 7,
  groupId: 'stannis',
  sourceId: 'stannis-guard-1',
  sourcePosition: Object.freeze({ x: 0, z: 0 }),
  lastKnown: Object.freeze({ x: 4, z: 2 }),
});

let lastRevision = 0;
const outside = evaluateAssist({
  alert,
  observer: { x: 30, z: 0 },
  groupId: 'stannis',
  sourceId: 'stannis-guard-2',
  lastRevision,
  assistRadiusMeters: 25,
});
assert.equal(outside.reason, 'range', 'fresh active alert must stay rejected while receiver is outside assist radius');
assert.equal(lastRevision, 0, 'range rejection must not consume the revision in the lifecycle contract');

const inside = evaluateAssist({
  alert,
  observer: { x: 24, z: 0 },
  groupId: 'stannis',
  sourceId: 'stannis-guard-2',
  lastRevision,
  assistRadiusMeters: 25,
});
assert.equal(inside.accepted, true, 'same active alert must become acceptable if the patrol enters assist radius');
lastRevision = inside.revision;
assert.equal(lastRevision, 7);
assert.equal(evaluateAssist({
  alert,
  observer: { x: 20, z: 0 },
  groupId: 'stannis',
  sourceId: 'stannis-guard-2',
  lastRevision,
  assistRadiusMeters: 25,
}).reason, 'stale', 'accepted alert must still be single-consume per receiver');

const channel = { groups: new Map([['stannis', alert]]) };
assert.equal(releaseOwnership({ alertChannel: channel, groupId: 'stannis', sourceId: 'stannis-guard-2' }), false,
  'non-owner dispose/loss must not delete another guard\'s active settlement alert');
assert.equal(channel.groups.get('stannis'), alert, 'failed ownership release must preserve the exact active alert');
assert.equal(releaseOwnership({ alertChannel: channel, groupId: 'stannis', sourceId: 'stannis-guard-1' }), true,
  'publisher loss/dispose must remove its own active settlement alert');
assert.equal(channel.groups.size, 0, 'publisher cleanup must leave no stale active alert');
assert.equal(releaseOwnership({ alertChannel: channel, groupId: 'stannis', sourceId: 'stannis-guard-1' }), false,
  'cleanup must be idempotent after the owned alert is gone');
assert.equal(evaluateAssist({
  alert: channel.groups.get('stannis'),
  observer: { x: 20, z: 0 },
  groupId: 'stannis',
  sourceId: 'stannis-guard-3',
  lastRevision: 0,
  assistRadiusMeters: 25,
}).accepted, false, 'cleared alert must not become a stale future investigation source');

const replacement = Object.freeze({ ...alert, revision: 8, sourceId: 'stannis-guard-3' });
channel.groups.set('stannis', replacement);
assert.equal(releaseOwnership({ alertChannel: channel, groupId: 'stannis', sourceId: 'stannis-guard-1' }), false,
  'late dispose from the previous publisher must not erase a newer publisher alert');
assert.equal(channel.groups.get('stannis'), replacement,
  'newer publisher ownership must survive stale publisher teardown');

assert.match(source,
  /if \(guardAlertPublished && !awareness\.visible\) \{\s*releaseNpcGuardAlertOwnership\(\{ alertChannel: guardAlertChannel, groupId: guardAlertGroupId, sourceId: guardSourceId \}\);\s*\}/,
  'visual-loss cleanup must delegate to the same ownership-safe release primitive used by dispose');
assert.match(source,
  /dispose\(\) \{\s*releaseNpcGuardAlertOwnership\(\{ alertChannel: guardAlertChannel, groupId: guardAlertGroupId, sourceId: guardSourceId \}\);\s*guardAlertPublished = false;/,
  'NPC dispose must synchronously release only its own active group alert before object cleanup');
assert.match(source,
  /if \(assist\.accepted \|\| assist\.reason === 'self'\) lastGuardAlertRevision = Math\.max\(lastGuardAlertRevision, assist\.revision\)/,
  'receiver revision must advance only after acceptance or publisher self-consumption');
assert.doesNotMatch(source,
  /if \(groupAlert\?\.revision > lastGuardAlertRevision\) lastGuardAlertRevision = groupAlert\.revision/,
  'out-of-range alerts must no longer be consumed unconditionally');
assert.match(source, /guardAlertGroupId: spawn\.seatId/,
  'guard assist must remain partitioned by canonical settlement seat');
assert.match(source, /guardAlertChannel = \{ nextRevision: 1, groups: new Map\(\) \}/,
  'configured NPC population must continue sharing the established alert channel');
assert.equal(source.includes('EditorMaterialStudio'), false,
  'NPC runtime must remain free of editor/DOM material UI imports');

console.log('NPC_GUARD_ASSIST_LIFECYCLE_PASS', JSON.stringify({
  rangeRejectionDoesNotConsume: true,
  reentryWhilePublisherActive: true,
  acceptedRevisionSingleConsume: true,
  publisherLossClearsAlert: true,
  publisherDisposeClearsAlert: true,
  nonOwnerCannotClear: true,
  stalePublisherCannotClearReplacement: true,
  cleanupIdempotent: true,
  staleFutureAssistBlocked: true,
  settlementPartitionPreserved: true,
}));
