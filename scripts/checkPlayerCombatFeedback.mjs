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
assert.match(
  source,
  /function captureCombatFeedbackContext\(\)[\s\S]*stamina:[\s\S]*poise:[\s\S]*state: movementState[\s\S]*position:/,
  'combat feedback must snapshot impact-time vitals/state/position before deferred health reconciliation',
);
assert.match(
  source,
  /function publishCombatFeedbackAfterHealth\(outcome, payload, rawAmount, blockedAmount\) \{\s*const context = captureCombatFeedbackContext\(\);\s*queueMicrotask\([\s\S]*payload\?\.appliedAmount[\s\S]*publishCombatFeedback\(outcome, rawAmount, appliedAmount, blockedAmount, context\)/,
  'damage feedback must reconcile the authoritative post-clamp health amount without reading respawn-mutated player context',
);
assert.match(source, /if \(!isGrounded \|\| guardBreakRemaining > 0\) \{[\s\S]*publishCombatFeedbackAfterHealth\(lastDefenseResult, payload, rawAmount, 0\)/, 'airborne and already guard-broken damage must still produce reconciled feedback');
assert.match(source, /if \(!guarding \|\| stamina <= 0\)[\s\S]*if \(poise <= 0\) triggerHitStagger\(\); publishCombatFeedbackAfterHealth\(lastDefenseResult, payload, rawAmount, 0\)/, 'unguarded hit/hit-stagger feedback must wait for the health clamp');
assert.match(source, /if \(poise <= 0\) triggerGuardBreak\(\); publishCombatFeedbackAfterHealth\(lastDefenseResult, payload, rawAmount, blockedAmount\)/, 'guard and guard-break feedback must preserve mitigation while using the health result');

assert.match(source, /gameEvents\.on\(EVENTS\.PLAYER_DIED, onPlayerDied\)/, 'player must consume the canonical death event to clear transient combat state');
assert.match(source, /gameEvents\.off\(EVENTS\.PLAYER_DIED, onPlayerDied\)/, 'player disposal must detach the death-state reset listener');
assert.match(
  source,
  /function onPlayerDied\(\) \{\s*if \(defeatResetQueued\) return;\s*interruptAttackForHit\(\);\s*defeatResetQueued = true;\s*queueMicrotask\(/,
  'death must interrupt an active attack synchronously at the impact position before game3d teleports the player',
);
const resetStart = source.indexOf('\tfunction resetAfterDefeat()');
const resetEnd = source.indexOf('\n\tfunction onPlayerDied()', resetStart);
assert.ok(resetStart >= 0 && resetEnd > resetStart, 'defeat reset function must remain explicit and bounded');
const resetBody = source.slice(resetStart, resetEnd);
for (const fragment of [
  'stamina = PLAYER_ACTION_CONFIG.MAX_STAMINA',
  'poise = PLAYER_ACTION_CONFIG.MAX_POISE',
  'guardBreakRemaining = 0',
  'hitStaggerRemaining = 0',
  'dodgeRemaining = 0',
  "attackKind = 'none'",
  'attackRemaining = 0',
  'parryWindowRemaining = 0',
  "movementState = 'idle'",
  'publishMotionTelemetry(true)',
]) assert.ok(resetBody.includes(fragment), `defeat reset missing transient-state cleanup: ${fragment}`);
assert.equal(resetBody.includes('interruptAttackForHit()'), false, 'queued post-teleport reset must not emit a late attack interruption from the respawn position');
assert.equal(resetBody.includes('attackSerial = 0'), false, 'respawn must not rewind attack receipt serials');
assert.equal(resetBody.includes('combatFeedbackSerial = 0'), false, 'respawn must not rewind combat feedback serials');

console.log('Player Combat Feedback Contract: PASS');
console.log('outcomes=dodge,parry,guard,guard-break,hit,hit-stagger,airborne-hit');
console.log('appliedDamage=authoritative-health-clamp|context=impact-snapshot');
console.log('defeatReset=transient-state-only|attack-interrupt=impact-time|serials=monotonic');
