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
assert.match(source, /publishCombatFeedback\(lastDefenseResult, rawAmount, rawAmount, 0\)/, 'unguarded hit/hit-stagger must publish full applied damage');
assert.match(source, /if \(poise <= 0\) triggerGuardBreak\(\); publishCombatFeedback\(lastDefenseResult, rawAmount, reducedAmount, blockedAmount\)/, 'guard and guard-break must publish post-resolution mitigation values');
assert.match(source, /if \(poise <= 0\) triggerHitStagger\(\); publishCombatFeedback\(lastDefenseResult, rawAmount, rawAmount, 0\)/, 'hit-stagger outcome must be published after the poise-break transition');

const feedbackCalls = source.match(/publishCombatFeedback\(/g) ?? [];
assert.equal(feedbackCalls.length, 5, 'expected one helper plus four authoritative damage-path calls');

console.log('Player Combat Feedback Contract: PASS');
console.log('outcomes=dodge,parry,guard,guard-break,hit,hit-stagger');
console.log('payload=serial,outcome,rawAmount,appliedAmount,blockedAmount,stamina,poise,state,position');
