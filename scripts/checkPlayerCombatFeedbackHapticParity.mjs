#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolvePlayerCombatFeedbackHaptic } from '../src/3d/input.js';

const playerSource = fs.readFileSync(new URL('../src/3d/gameplay/player.js', import.meta.url), 'utf8');
const inputSource = fs.readFileSync(new URL('../src/3d/input.js', import.meta.url), 'utf8');

const cases = Object.freeze([
  ['dodge', { blockedAmount: 10 }],
  ['parry', { blockedAmount: 10 }],
  ['guard', { blockedAmount: 6 }],
  ['guard-break', { appliedAmount: 4, blockedAmount: 6 }],
  ['hit', { appliedAmount: 10 }],
  ['hit-stagger', { appliedAmount: 10 }],
]);

assert.match(playerSource, /const COMBAT_FEEDBACK_EVENT = 'aapw:player-combat-feedback';/, 'player must publish the canonical combat feedback event');
assert.match(inputSource, /const COMBAT_FEEDBACK_EVENT = 'aapw:player-combat-feedback';/, 'input must consume the canonical combat feedback event');
assert.match(playerSource, /publishCombatFeedback\('dodge', rawAmount, 0, rawAmount\)/, 'dodge must publish authoritative full-block evidence');
assert.match(playerSource, /publishCombatFeedback\('parry', rawAmount, 0, rawAmount\)/, 'parry must publish authoritative full-block evidence');
for (const outcome of ['guard', 'guard-break', 'hit', 'hit-stagger']) {
  assert.match(playerSource, new RegExp(`lastDefenseResult = '${outcome}'`), `${outcome} must remain an authoritative player defense result`);
}
assert.match(playerSource, /publishCombatFeedbackAfterHealth\(lastDefenseResult, payload, rawAmount, blockedAmount\)/, 'guard-family feedback must reconcile against the health receipt');
assert.match(playerSource, /publishCombatFeedbackAfterHealth\(lastDefenseResult, payload, rawAmount, 0\)/, 'hit-family feedback must reconcile against the health receipt');

const durations = new Set();
for (const [outcome, evidence] of cases) {
  const profile = resolvePlayerCombatFeedbackHaptic({ outcome, ...evidence });
  assert.ok(profile, `${outcome} emitted by Player must have a gamepad result-haptic profile`);
  assert.ok(Number.isFinite(profile.duration) && profile.duration > 0 && profile.duration <= 150, `${outcome} duration must stay bounded`);
  assert.ok(profile.weakMagnitude >= 0 && profile.weakMagnitude <= 1, `${outcome} weak magnitude must stay bounded`);
  assert.ok(profile.strongMagnitude >= 0 && profile.strongMagnitude <= 1, `${outcome} strong magnitude must stay bounded`);
  durations.add(profile.duration);
}
assert.equal(durations.size, cases.length, 'combat outcomes must keep distinct tactile timing instead of collapsing to one generic pulse');

for (const invalid of [
  { outcome: 'dodge', blockedAmount: 0 },
  { outcome: 'guard', blockedAmount: -1 },
  { outcome: 'hit', appliedAmount: 0 },
  { outcome: 'hit-stagger', appliedAmount: NaN },
  { outcome: 'guard-break', appliedAmount: 0, blockedAmount: 0 },
]) assert.equal(resolvePlayerCombatFeedbackHaptic(invalid), null, `${invalid.outcome} without authoritative positive evidence must not vibrate`);

console.log('PLAYER_COMBAT_FEEDBACK_HAPTIC_PARITY_OK');
console.log(`outcomes=${cases.map(([outcome]) => outcome).join(',')}`);
console.log(`distinctDurations=${durations.size}`);
