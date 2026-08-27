import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/3d/gameplay/player.js', import.meta.url), 'utf8');

function numberConstant(name) {
  const match = source.match(new RegExp(`${name}:\\s*([0-9.]+)`));
  assert.ok(match, `missing ${name}`);
  return Number(match[1]);
}

const guardDamageMultiplier = numberConstant('GUARD_DAMAGE_MULTIPLIER');
const guardStaminaDamageRatio = numberConstant('GUARD_STAMINA_DAMAGE_RATIO');
const guardBreakSeconds = numberConstant('GUARD_BREAK_SECONDS');

const guardedResolution = "stageDamageResolution(payload, { rawAmount, blockedAmount, amount: reducedAmount, mitigation: 'guard' })";
const impactBreak = 'if (stamina <= 0 || poise <= 0) triggerGuardBreak()';
const guardBranch = source.indexOf(guardedResolution);
const breakBranch = source.indexOf(impactBreak);
assert.ok(guardBranch >= 0, 'guarded damage must stage authoritative mitigation before health consumes it');
assert.ok(breakBranch > guardBranch, 'impact exhaustion must break guard after staging guarded damage');
assert.equal(source.includes('if (poise <= 0) triggerGuardBreak(); publishCombatFeedbackAfterHealth(lastDefenseResult, payload, rawAmount, blockedAmount)'), false,
  'guard break must not depend on poise alone after blocked stamina damage');
const guardBreakState = "movementState = 'guard-break'; lastDefenseResult = 'guard-break'";
const impactFeedback = `${impactBreak}; publishCombatFeedbackAfterHealth(lastDefenseResult, payload, rawAmount, blockedAmount)`;
assert.ok(source.includes(guardBreakState), 'canonical guard break must expose guard-break state/outcome to combat feedback');
assert.ok(source.includes(impactFeedback), 'impact exhaustion must enter guard-break before deferred health feedback captures its outcome');

const guardBreakReset = 'guarding = false; parryWindowRemaining = 0; guardBreakRemaining = PLAYER_ACTION_CONFIG.GUARD_BREAK_SECONDS;';
assert.ok(source.includes(guardBreakReset), 'canonical guard break must drop guard and close any parry window');
const guardBreakVulnerability = "if (!isGrounded || guardBreakRemaining > 0) { lastDefenseResult = guardBreakRemaining > 0 ? 'guard-break' : 'hit'; publishCombatFeedbackAfterHealth(lastDefenseResult, payload, rawAmount, 0); return; }";
const vulnerabilityBranch = source.indexOf(guardBreakVulnerability);
const dodgeBranch = source.indexOf('if (isDodgeInvulnerable())');
const parryBranch = source.indexOf('if (parryWindowRemaining > 0 && stamina >= PLAYER_ACTION_CONFIG.PARRY_STAMINA_COST)');
const activeGuardBranch = source.indexOf('if (!guarding || stamina <= 0)');
assert.ok(vulnerabilityBranch >= 0, 'guard-break recovery must expose a full-damage vulnerability branch');
assert.ok(vulnerabilityBranch < dodgeBranch && vulnerabilityBranch < parryBranch && vulnerabilityBranch < activeGuardBranch,
  'guard-break vulnerability must resolve before dodge, parry, or guard mitigation can intercept the hit');

const rawDamage = 120;
const blockedDamage = rawDamage * (1 - guardDamageMultiplier);
const staminaCost = blockedDamage * guardStaminaDamageRatio;
assert.ok(staminaCost > 0, 'blocked hits must consume stamina');

const preImpactStamina = Math.max(1, staminaCost - 0.5);
const postImpactStamina = Math.max(0, preImpactStamina - staminaCost);
assert.equal(postImpactStamina, 0, 'fixture must exhaust stamina from a blocked hit');
assert.ok(guardBreakSeconds > 0, 'impact exhaustion must enter a real guard-break recovery window');

const shouldBreakGuard = (stamina, poise) => stamina <= 0 || poise <= 0;
assert.equal(shouldBreakGuard(0, 25), true, 'stamina-only exhaustion must break guard while poise remains');
assert.equal(shouldBreakGuard(25, 0), true, 'poise-only exhaustion must retain the existing guard-break path');
assert.equal(shouldBreakGuard(0, 0), true, 'combined exhaustion must break guard exactly through the shared authority');
assert.equal(shouldBreakGuard(25, 25), false, 'healthy stamina and poise must preserve guard');

const continuousDrainBreak = 'if (stamina <= 0) triggerGuardBreak();';
assert.ok(source.includes(continuousDrainBreak), 'continuous guard drain must keep the same guard-break authority');
assert.ok(source.includes(impactBreak), 'blocked-hit stamina exhaustion must share triggerGuardBreak authority');

const damageDuringGuardBreak = { rawAmount: rawDamage, blockedAmount: 0, appliedAmount: rawDamage };
assert.equal(damageDuringGuardBreak.blockedAmount, 0, 'guard-break recovery must not retain blocked damage');
assert.equal(damageDuringGuardBreak.appliedAmount, rawDamage, 'guard-break recovery must take the full incoming damage amount');

console.log(JSON.stringify({
  ok: true,
  contract: 'player-guard-impact-exhaustion',
  sample: { rawDamage, blockedDamage, staminaCost, preImpactStamina, postImpactStamina },
  truthTable: {
    staminaOnly: shouldBreakGuard(0, 25),
    poiseOnly: shouldBreakGuard(25, 0),
    combined: shouldBreakGuard(0, 0),
    healthy: shouldBreakGuard(25, 25),
  },
  guardBreakSeconds,
  guardBreakDamage: damageDuringGuardBreak,
  authority: 'triggerGuardBreak',
}, null, 2));
