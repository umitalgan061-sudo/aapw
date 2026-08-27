import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/3d/gameplay/player.js', import.meta.url), 'utf8');
const hud = await readFile(new URL('../src/3d/ui/healthBar.js', import.meta.url), 'utf8');
const input = await readFile(new URL('../src/3d/input.js', import.meta.url), 'utf8');
const touch = await readFile(new URL('../src/3d/ui/touchJoystick.js', import.meta.url), 'utf8');
const helpers = await readFile(new URL('../src/3d/gameLoopHelpers.js', import.meta.url), 'utf8');

function numberConstant(name) {
  const match = source.match(new RegExp(`${name}:\\s*([0-9.]+)`));
  assert.ok(match, `missing ${name}`);
  return Number(match[1]);
}

const cfg = Object.freeze({
  maxStamina: numberConstant('MAX_STAMINA'), maxPoise: numberConstant('MAX_POISE'), sprintSpeed: numberConstant('SPRINT_SPEED_MPS'),
  sprintDrain: numberConstant('SPRINT_DRAIN_PER_SECOND'), restart: numberConstant('SPRINT_RESTART_STAMINA'),
  regen: numberConstant('STAMINA_REGEN_PER_SECOND'), dodgeCost: numberConstant('DODGE_COST'), dodgeDuration: numberConstant('DODGE_DURATION_SECONDS'),
  dodgeSpeed: numberConstant('DODGE_SPEED_MPS'), collisionStep: numberConstant('MAX_COLLISION_STEP_METERS'), maxFrameDelta: numberConstant('MAX_FRAME_DELTA_SECONDS'),
  guardDrain: numberConstant('GUARD_DRAIN_PER_SECOND'), guardMoveMultiplier: numberConstant('GUARD_MOVE_SPEED_MULTIPLIER'),
  guardDamageMultiplier: numberConstant('GUARD_DAMAGE_MULTIPLIER'), guardStaminaDamageRatio: numberConstant('GUARD_STAMINA_DAMAGE_RATIO'),
  guardPoiseDamageRatio: numberConstant('GUARD_POISE_DAMAGE_RATIO'), parryWindow: numberConstant('PARRY_WINDOW_SECONDS'), parryCost: numberConstant('PARRY_STAMINA_COST'),
  poiseRegen: numberConstant('POISE_REGEN_PER_SECOND'), poiseRegenDelay: numberConstant('POISE_REGEN_DELAY_SECONDS'),
  hitPoiseDamageRatio: numberConstant('HIT_POISE_DAMAGE_RATIO'), hitStaggerSeconds: numberConstant('HIT_STAGGER_SECONDS'), hitStaggerPoiseRecovery: numberConstant('HIT_STAGGER_POISE_RECOVERY'),
  guardBreakSeconds: numberConstant('GUARD_BREAK_SECONDS'), guardBreakStaminaPenalty: numberConstant('GUARD_BREAK_STAMINA_PENALTY'),
});

assert.equal(cfg.maxStamina, 100); assert.equal(cfg.maxPoise, 100);
assert.ok(cfg.sprintSpeed > 6 && cfg.sprintDrain > 0 && cfg.regen > 0);
assert.ok(cfg.restart > 0 && cfg.restart < cfg.maxStamina);
assert.ok(cfg.dodgeCost > 0 && cfg.dodgeCost < cfg.maxStamina && cfg.dodgeDuration > 0 && cfg.dodgeDuration < 0.75);
assert.ok(cfg.dodgeSpeed > cfg.sprintSpeed && cfg.collisionStep <= 0.5 && cfg.maxFrameDelta <= 0.1);
assert.ok(cfg.guardDrain > 0 && cfg.guardMoveMultiplier > 0 && cfg.guardMoveMultiplier < 1);
assert.ok(cfg.guardDamageMultiplier > 0 && cfg.guardDamageMultiplier < 0.5);
assert.ok(cfg.guardStaminaDamageRatio > 0 && cfg.guardPoiseDamageRatio >= 1);
assert.ok(cfg.parryWindow > 0 && cfg.parryWindow <= 0.2 && cfg.parryCost > 0);
assert.ok(cfg.poiseRegen > 0 && cfg.poiseRegenDelay >= 0.5 && cfg.guardBreakSeconds >= 0.5 && cfg.guardBreakSeconds <= 1.2);
assert.ok(cfg.guardBreakStaminaPenalty > 0 && cfg.guardBreakStaminaPenalty < cfg.maxStamina);
assert.ok(cfg.hitPoiseDamageRatio > 0 && cfg.hitPoiseDamageRatio <= 2);
assert.ok(cfg.hitStaggerSeconds > 0 && cfg.hitStaggerSeconds < cfg.guardBreakSeconds);
assert.ok(cfg.hitStaggerPoiseRecovery > 0 && cfg.hitStaggerPoiseRecovery < cfg.maxPoise);

for (const fragment of [
  'groundCollider.getGroundHeight', 'playerCollider.resolveXZ',
  'Math.ceil(travelMeters / PLAYER_ACTION_CONFIG.MAX_COLLISION_STEP_METERS)',
  'runJumpDodgeRequested = Boolean(jumpRequested) && runIntent', 'canStartDodge()', 'startDodge(moveDirectionXZ)',
  "movementState = 'dodge'", "movementState = 'guard'", "movementState = 'parry'", "movementState = 'guard-break'", "movementState = 'hit-stagger'",
  'spendPoise(blockedAmount * PLAYER_ACTION_CONFIG.GUARD_POISE_DAMAGE_RATIO)', 'if (stamina <= 0 || poise <= 0) triggerGuardBreak()',
  'spendPoise(rawAmount * PLAYER_ACTION_CONFIG.HIT_POISE_DAMAGE_RATIO)', 'if (poise <= 0) triggerHitStagger()',
  'guarding = guardIntent && attackRemaining <= 0 && guardBreakRemaining <= 0 && hitStaggerRemaining <= 0',
  'guardBreakRemaining <= 0 && hitStaggerRemaining <= 0 && jumpRequested',
  "gameEvents.on(EVENTS.PLAYER_DAMAGED, onIncomingDamage)", "mitigation: 'parry'", "mitigation: 'guard'",
  'stageDamageResolution(payload, { amount: rawAmount })',
  'hitStaggerRemaining: Number(hitStaggerRemaining.toFixed(3))', "globalThis.CustomEvent('aapw:player-motion'",
]) assert.ok(source.includes(fragment), `missing runtime contract: ${fragment}`);
assert.equal(source.includes("payload.mitigation = 'parry'"), false, 'parry must not require mutable producer payloads');
assert.equal(source.includes("payload.mitigation = 'guard'"), false, 'guard must not require mutable producer payloads');

assert.ok(hud.includes("className = 'g3d-poise-bar'"));
assert.ok(hud.includes("setAttribute('aria-label', 'Denge')"));
assert.ok(hud.includes("'guard-break': 'Savunma kırıldı'"));
for (const fragment of [
  "className = 'g3d-combat-status'", "setAttribute('role', 'status')", "setAttribute('aria-live', 'polite')",
  "addEventListener('aapw:player-lock-on'", "addEventListener('aapw:player-attack-window'", '_paintLockOn(detail)', '_paintAttack(detail)',
  "'active-start': 'VURUŞ'", "const DEFENSE_LABELS = Object.freeze({ guard: 'BLOK', parry: 'PARRY' })", '_paintDefense(payload)',
  "payload) => { this._flash(); this._paintDefense(payload); }", "this._combatDefense ? `defense-${this._combatDefense.mitigation}`",
  'blockedAmount: Number.isFinite(payload?.blockedAmount)', 'appliedAmount: Number.isFinite(payload?.amount)', 'savuşturuldu', 'engellendi',
  'reachMeters: Number.isFinite(detail.reachMeters)', 'damageScale: Number.isFinite(detail.damageScale)',
  'Number.isFinite(this._combatAttack?.reachMeters)', 'Number.isFinite(this._combatLock?.distanceMeters)',
  'this._combatLock.distanceMeters <= this._combatAttack.reachMeters', "targetInRange ? 'MENZİLDE' : 'UZAK'", "dataset.range = targetInRange === null ? 'unknown' : targetInRange ? 'in-range' : 'out-of-range'",
  'const TARGET_FEEDBACK_SECONDS = 0.9', "detail?.reason === 'no-target'", "this._renderCombatStatus('Hedef yok')", '_targetTimeoutId = setTimeout', 'clearTimeout(this._targetTimeoutId)',
  "removeEventListener('aapw:player-lock-on'", "removeEventListener('aapw:player-attack-window'", 'clearTimeout(this._defenseTimeoutId)',
]) assert.ok(hud.includes(fragment), `missing combat HUD contract: ${fragment}`);
assert.ok(!hud.includes('this._combatLock?.distanceMeters !== null'), 'absent lock must never be treated as a valid range sample');
assert.ok(input.includes("const GUARD_KEYS = new Set(['KeyQ'])"));
assert.ok(input.includes('GUARD_POINTER_BUTTON = 2'));
assert.match(input, /return\s*\{[^}]*\bguarding\b[^}]*\}/s);
assert.ok(touch.includes("textContent = 'Savun'"));
assert.ok(helpers.includes('guarding: Boolean(keyboardAxes.guarding || joystickAxes.guarding)'));
assert.ok(!source.includes('EditorMaterialStudio'));
assert.ok(!source.includes('new THREE.CapsuleGeometry'));

const rawDamage = 20;
const guardedDamage = rawDamage * cfg.guardDamageMultiplier;
const blockedDamage = rawDamage - guardedDamage;
const guardStaminaCost = blockedDamage * cfg.guardStaminaDamageRatio;
const guardPoiseCost = blockedDamage * cfg.guardPoiseDamageRatio;
assert.ok(guardedDamage <= 8 && guardStaminaCost > 0 && guardPoiseCost > guardStaminaCost);
const hitsToBreak = Math.ceil(cfg.maxPoise / guardPoiseCost);
assert.ok(hitsToBreak >= 4 && hitsToBreak <= 8, `guard break should require a bounded short pressure sequence, got ${hitsToBreak}`);
assert.ok(cfg.poiseRegen * cfg.guardBreakSeconds < cfg.maxPoise, 'guard break cannot refill poise during stagger');
const unguardedHitsToStagger = Math.ceil(cfg.maxPoise / (rawDamage * cfg.hitPoiseDamageRatio));
assert.ok(unguardedHitsToStagger >= 3 && unguardedHitsToStagger <= 8, `hit stagger should require a bounded pressure sequence, got ${unguardedHitsToStagger}`);

console.log(JSON.stringify({
  ok: true, contract: 'player-stamina-dodge-guard-parry-poise-hit-stagger-combat-hud',
  stamina: { max: cfg.maxStamina, sprintSpeedMps: cfg.sprintSpeed, dodgeSpeedMps: cfg.dodgeSpeed },
  guard: { damageMultiplier: cfg.guardDamageMultiplier, sample20AppliedDamage: guardedDamage, sample20StaminaCost: guardStaminaCost },
  poise: { max: cfg.maxPoise, sample20PoiseCost: guardPoiseCost, hitsToBreak, unguardedHitsToStagger, hitStaggerSeconds: cfg.hitStaggerSeconds, hitStaggerPoiseRecovery: cfg.hitStaggerPoiseRecovery, regenPerSecond: cfg.poiseRegen, regenDelaySeconds: cfg.poiseRegenDelay, guardBreakSeconds: cfg.guardBreakSeconds },
  parry: { windowSeconds: cfg.parryWindow, staminaCost: cfg.parryCost },
  combatHud: { lockOnEvent: 'aapw:player-lock-on', attackWindowEvent: 'aapw:player-attack-window', defenseMitigation: ['guard', 'parry'], defenseAmounts: true, accessibleLiveStatus: true, meleeRangeCue: ['in-range', 'out-of-range', 'unknown'], failedTargetFeedbackSeconds: 0.9 },
}, null, 2));
