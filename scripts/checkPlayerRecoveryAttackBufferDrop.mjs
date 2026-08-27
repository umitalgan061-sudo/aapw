#!/usr/bin/env node
import fs from 'node:fs';

const playerPath = 'src/3d/gameplay/player.js';
const source = fs.readFileSync(playerPath, 'utf8');
const need = (ok, message) => {
  if (!ok) throw new Error(`[player-recovery-attack-buffer-drop] ${message}`);
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
const updateStart = source.indexOf('update(delta, moveDirectionXZ');
const updateEnd = source.indexOf('dispose()', updateStart);
need(updateStart >= 0 && updateEnd > updateStart, 'missing player update loop');
const update = source.slice(updateStart, updateEnd);

need(/ATTACK_COMBO_BUFFER_SECONDS:\s*0\.28\b/.test(config), 'attack combo buffer must stay bounded at 0.28s');
need(/PARRY_FEEDBACK_SECONDS:\s*0\.18\b/.test(config), 'parry recovery must stay explicit at 0.18s');
need(onCombatInput.includes("kind !== 'light' && kind !== 'heavy'"), 'combat input must reject unsupported attack kinds');
need(onCombatInput.includes('attackRemaining <= 0') && onCombatInput.includes('!canStartAttack(kind)'), 'idle/recovery attack input must be rejected before entering the combo buffer');
need(onCombatInput.indexOf('!canStartAttack(kind)') < onCombatInput.indexOf('bufferedAttackKind = kind'), 'recovery eligibility must be checked before buffer capture');
need(onCombatInput.includes('bufferedAttackKind = kind'), 'eligible input and active-attack follow-ups must still use the existing combo buffer');
need(onCombatInput.includes('attackBufferRemaining = PLAYER_ACTION_CONFIG.ATTACK_COMBO_BUFFER_SECONDS'), 'accepted input must preserve the canonical combo buffer duration');

for (const gate of ['guardBreakRemaining <= 0', 'hitStaggerRemaining <= 0', 'dodgeRemaining <= 0', 'parryFeedbackRemaining <= 0', '!guarding', 'isGrounded', 'stamina >= tuning.cost']) {
  need(canStartAttack.includes(gate), `canStartAttack must preserve recovery gate: ${gate}`);
}

need(update.includes("startAttack(bufferedAttackKind, false)"), 'buffer consumption must remain routed through canonical startAttack');
need(update.includes('attackBufferRemaining = Math.max(0, attackBufferRemaining - dt)'), 'accepted combo buffers must still age every frame');

const bufferSeconds = 0.28;
const parryRecoverySeconds = 0.18;
need(bufferSeconds > parryRecoverySeconds, 'regression fixture requires buffer to outlive parry recovery so stale capture would be observable');

console.log(JSON.stringify({
  contract: 'player-recovery-attack-buffer-drop-v1',
  bufferSeconds,
  parryRecoverySeconds,
  rule: 'idle-or-recovery input must be eligible now; only active attacks may retain follow-up combo input',
}, null, 2));
console.log('PLAYER_RECOVERY_ATTACK_BUFFER_DROP_OK');
