#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';

const playerPath = new URL('../src/3d/gameplay/player.js', import.meta.url);
const source = fs.readFileSync(playerPath, 'utf8');

assert.match(source, /const COMBAT_FEEDBACK_EVENT = 'aapw:player-combat-feedback';/, 'player combat feedback event must stay canonical');
assert.match(source, /combatFeedbackSerial \+= 1;/, 'feedback events must have a monotonic local serial');
assert.match(source, /detail: Object\.freeze\(\{[\s\S]*serial: combatFeedbackSerial,[\s\S]*outcome,[\s\S]*rawAmount:[\s\S]*appliedAmount:[\s\S]*blockedAmount:[\s\S]*stamina:[\s\S]*poise:[\s\S]*state:[\s\S]*position:/, 'feedback payload must be immutable and carry authoritative combat context');

for (const outcome of ['dodge', 'parry']) {
  assert.match(source, new RegExp(`publishCombatFeedback\\('${outcome}', rawAmount, 0, rawAmount\\)`), `${outcome} must publish a zero-damage full-block receipt`);
}
assert.match(source, /function publishCombatFeedbackAfterHealth\(outcome, payload, rawAmount, blockedAmount\)[\s\S]*queueMicrotask\([\s\S]*payload\?\.appliedAmount[\s\S]*publishCombatFeedback\(outcome, rawAmount, appliedAmount, blockedAmount\)/, 'damage feedback must reconcile against the authoritative post-clamp health receipt');
assert.match(source, /if \(!isGrounded \|\| guardBreakRemaining > 0\) \{[\s\S]*publishCombatFeedbackAfterHealth\(lastDefenseResult, payload, rawAmount, 0\)/, 'airborne and already guard-broken damage must still produce reconciled feedback');
assert.match(source, /if \(!guarding \|\| stamina <= 0\)[\s\S]*if \(poise <= 0\) triggerHitStagger\(\); publishCombatFeedbackAfterHealth\(lastDefenseResult, payload, rawAmount, 0\)/, 'unguarded hit/hit-stagger feedback must wait for the health clamp');
assert.match(source, /if \(poise <= 0\) triggerGuardBreak\(\); publishCombatFeedbackAfterHealth\(lastDefenseResult, payload, rawAmount, blockedAmount\)/, 'guard and guard-break feedback must preserve mitigation while using the health result');

console.log('Player Combat Feedback Contract: PASS');
console.log('outcomes=dodge,parry,guard,guard-break,hit,hit-stagger,airborne-hit');
console.log('appliedDamage=authoritative-health-clamp');
