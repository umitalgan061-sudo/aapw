#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/3d/gameplay/player.js', import.meta.url), 'utf8');
const healthBar = await readFile(new URL('../src/3d/ui/healthBar.js', import.meta.url), 'utf8');
const numberConstant = (name) => {
  const match = source.match(new RegExp(`${name}:\\s*([0-9.]+)`));
  assert.ok(match, `missing ${name}`);
  return Number(match[1]);
};

const duration = numberConstant('DODGE_DURATION_SECONDS');
const start = numberConstant('DODGE_IFRAME_START_SECONDS');
const end = numberConstant('DODGE_IFRAME_END_SECONDS');
const attackBuffer = numberConstant('ATTACK_COMBO_BUFFER_SECONDS');

assert.ok(duration >= 0.3 && duration <= 0.5, `unexpected dodge duration ${duration}`);
assert.ok(start > 0, 'dodge must not be invulnerable on frame zero');
assert.ok(start < end, 'dodge iframe start must precede end');
assert.ok(end < duration, 'dodge recovery tail must remain vulnerable');
assert.ok(end - start >= 0.12 && end - start <= 0.22, 'iframe window must remain useful but bounded');
assert.ok(attackBuffer > duration - end, 'attack buffer must outlive the vulnerable dodge recovery tail');
assert.ok(attackBuffer < duration, 'attack buffer must stay bounded below the full dodge duration');

const invulnerableAt = (elapsed) => elapsed >= start && elapsed < end && elapsed < duration;
assert.equal(invulnerableAt(0), false, 'dodge startup must be vulnerable');
assert.equal(invulnerableAt(start - 0.001), false, 'pre-window dodge must be vulnerable');
assert.equal(invulnerableAt(start + 0.001), true, 'active iframe window must be invulnerable');
assert.equal(invulnerableAt(end - 0.001), true, 'late active iframe sample must remain invulnerable');
assert.equal(invulnerableAt(end), false, 'dodge recovery must become vulnerable at the end boundary');
assert.equal(invulnerableAt(duration), false, 'completed dodge must be vulnerable');

for (const fragment of [
  'function dodgeElapsedSeconds()',
  'function isDodgeInvulnerable()',
  'dodgeRemaining > 0 && elapsed >= PLAYER_ACTION_CONFIG.DODGE_IFRAME_START_SECONDS',
  "payload.mitigation = 'dodge'",
  'payload.blockedAmount = rawAmount',
  'payload.amount = 0',
  "lastDefenseResult = 'dodge'",
  'dodgeElapsedSeconds: Number(dodgeElapsed.toFixed(3)), dodgeInvulnerable',
  'publishMotionTelemetry(true); return;',
  'attackBufferRemaining = Math.max(0, attackBufferRemaining - dt)',
  "if (attackBufferRemaining <= 0 && attackRemaining <= 0) bufferedAttackKind = 'none'",
  "if (attackRemaining <= 0 && attackBufferRemaining > 0 && bufferedAttackKind !== 'none') startAttack(bufferedAttackKind, false)",
  'dodgeRemaining <= 0 && parryFeedbackRemaining <= 0',
]) assert.ok(source.includes(fragment), `missing dodge iframe/recovery contract: ${fragment}`);

const bufferedAttackAttempt = source.indexOf("if (attackRemaining <= 0 && attackBufferRemaining > 0 && bufferedAttackKind !== 'none') startAttack(bufferedAttackKind, false)");
const dodgeMotionBranch = source.indexOf('} else if (dodgeRemaining > 0) {');
assert.ok(bufferedAttackAttempt > 0 && dodgeMotionBranch > bufferedAttackAttempt, 'buffered attacks must be attempted without skipping the authoritative dodge motion branch');
assert.ok(source.indexOf('dodgeRemaining <= 0 && parryFeedbackRemaining <= 0') < source.indexOf('function startAttack'), 'attack start eligibility must retain dodge completion gating');

for (const fragment of [
  "dodge: 'KAÇINMA'",
  "this._combatDefense?.mitigation === 'dodge' ? 'önlendi'",
  '`defense-${this._combatDefense.mitigation}`',
  'DEFENSE_FEEDBACK_SECONDS',
  'this._combatDodgeInvulnerable = false',
  'this._combatDodgeRecovery = false',
  "state === 'dodge' && motion?.dodgeInvulnerable === true",
  'const wasDodgeInvulnerable = this._combatDodgeInvulnerable',
  "state === 'dodge' && !dodgeInvulnerable && (this._combatDodgeRecovery || wasDodgeInvulnerable)",
  "'KAÇINMA · DOKUNULMAZ'",
  "'KAÇINMA · TOPARLANMA · SAVUNMASIZ'",
  "'dodge-invulnerable'",
  "'dodge-recovery'",
  'this._combatAttack || this._combatDefense || this._combatDodgeInvulnerable || this._combatDodgeRecovery',
]) assert.ok(healthBar.includes(fragment), `missing dodge combat HUD contract: ${fragment}`);

assert.ok(source.indexOf('if (isDodgeInvulnerable())') < source.indexOf('if (parryWindowRemaining > 0'), 'active dodge mitigation must be resolved before guard/parry handling');
assert.notEqual(start, 0, 'frame-zero dodge immunity must stay forbidden');
assert.notEqual(end, duration, 'full-duration dodge immunity must stay forbidden');
assert.ok(!healthBar.includes('DODGE_IFRAME_START_SECONDS'), 'HUD must consume canonical dodgeInvulnerable telemetry instead of duplicating iframe tuning');
assert.ok(!healthBar.includes('DODGE_IFRAME_END_SECONDS'), 'HUD must not own a second iframe timing contract');

console.log(JSON.stringify({
  ok: true,
  contract: 'player-dodge-invulnerability',
  dodge: { durationSeconds: duration, iframeStartSeconds: start, iframeEndSeconds: end, iframeDurationSeconds: Number((end - start).toFixed(3)), recoverySeconds: Number((duration - end).toFixed(3)), attackBufferSeconds: attackBuffer },
  mitigation: { event: 'PLAYER_DAMAGED', mitigation: 'dodge', amount: 0, hud: 'KAÇINMA', iframeHud: 'KAÇINMA · DOKUNULMAZ', recoveryHud: 'KAÇINMA · TOPARLANMA · SAVUNMASIZ', preservesNpcOwnership: true },
  recoveryAttackBuffer: { dodgeCancelForbidden: true, survivesRecoveryTail: true },
}, null, 2));
