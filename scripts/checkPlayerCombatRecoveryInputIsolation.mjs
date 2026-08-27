#!/usr/bin/env node
import fs from 'node:fs';

const playerPath = 'src/3d/gameplay/player.js';
const source = fs.readFileSync(playerPath, 'utf8');
const need = (ok, message) => {
  if (!ok) throw new Error(`[player-combat-recovery-input] ${message}`);
};
const sliceFunction = (name, nextName) => {
  const start = source.indexOf(`function ${name}`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : -1;
  need(start >= 0, `missing ${name}()`);
  return source.slice(start, end >= 0 ? end : undefined);
};

const config = source.slice(source.indexOf('const PLAYER_ACTION_CONFIG'), source.indexOf('const COMBAT_INPUT_EVENT'));
const canStartAttack = sliceFunction('canStartAttack', 'startAttack');
const onCombatInput = sliceFunction('onCombatInput', 'canStartDodge');
const interruptAttackForHit = sliceFunction('interruptAttackForHit', 'triggerHitStagger');
const triggerHitStagger = sliceFunction('triggerHitStagger', 'canStartAttack');
const updateStart = source.indexOf('update(delta, moveDirectionXZ');
const updateEnd = source.indexOf('dispose()', updateStart);
need(updateStart >= 0 && updateEnd > updateStart, 'missing player update loop');
const update = source.slice(updateStart, updateEnd);

need(/ATTACK_COMBO_BUFFER_SECONDS:\s*0\.28\b/.test(config), 'attack buffer must stay explicitly bounded');
need(/HIT_STAGGER_SECONDS:\s*0\.32\b/.test(config), 'hit-stagger recovery must remain longer than the current attack buffer');
need(/GUARD_BREAK_SECONDS:\s*0\.75\b/.test(config), 'guard-break recovery must remain longer than the current attack buffer');

for (const gate of [
  'attackRemaining <= 0',
  'guardBreakRemaining <= 0',
  'hitStaggerRemaining <= 0',
  'dodgeRemaining <= 0',
  'parryFeedbackRemaining <= 0',
  '!guarding',
  'isGrounded',
  'stamina >= tuning.cost',
]) {
  need(canStartAttack.includes(gate), `canStartAttack must preserve recovery gate: ${gate}`);
}

need(/kind !== 'light' && kind !== 'heavy'/.test(onCombatInput), 'combat input must reject unsupported attack kinds');
need(onCombatInput.includes('attackBufferRemaining = PLAYER_ACTION_CONFIG.ATTACK_COMBO_BUFFER_SECONDS'), 'combat input must use the bounded combo buffer');
need(interruptAttackForHit.includes("bufferedAttackKind = 'none'"), 'active attack interruption must clear buffered follow-up input');
need(interruptAttackForHit.includes('attackBufferRemaining = 0'), 'active attack interruption must clear the buffer timer');
need(triggerHitStagger.includes('interruptAttackForHit()'), 'hit stagger must use canonical attack interruption');

need(update.includes('attackBufferRemaining = Math.max(0, attackBufferRemaining - dt)'), 'recovery frames must age the attack buffer');
need(update.includes("if (attackBufferRemaining <= 0 && attackRemaining <= 0) bufferedAttackKind = 'none'"), 'expired idle/recovery buffers must be discarded');
need(update.includes("if (attackRemaining <= 0 && hitStaggerRemaining <= 0 && attackBufferRemaining > 0 && bufferedAttackKind !== 'none') startAttack(bufferedAttackKind, false)"), 'buffer consumption must still route through startAttack');
need(update.indexOf('guardBreakRemaining = Math.max(0, guardBreakRemaining - dt)') < update.indexOf("startAttack(bufferedAttackKind, false)"), 'guard-break timer must update before any buffered attack attempt');
need(update.indexOf('hitStaggerRemaining = Math.max(0, hitStaggerRemaining - dt)') < update.indexOf("startAttack(bufferedAttackKind, false)"), 'hit-stagger timer must update before any buffered attack attempt');

const bufferSeconds = 0.28;
const hitStaggerSeconds = 0.32;
const guardBreakSeconds = 0.75;
need(bufferSeconds < hitStaggerSeconds && bufferSeconds < guardBreakSeconds, 'incapacitation windows must outlive a fresh attack buffer');

console.log(JSON.stringify({
  contract: 'player-combat-recovery-input-isolation-v1',
  attackBufferSeconds: bufferSeconds,
  hitStaggerSeconds,
  guardBreakSeconds,
  recoveryGates: ['guard-break', 'hit-stagger', 'dodge', 'parry-feedback', 'guard', 'airborne', 'stamina'],
}, null, 2));
console.log('PLAYER_COMBAT_RECOVERY_INPUT_ISOLATION_OK');
