import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/3d/gameplay/player.js', import.meta.url), 'utf8');
const input = await readFile(new URL('../src/3d/input.js', import.meta.url), 'utf8');
const touch = await readFile(new URL('../src/3d/ui/touchJoystick.js', import.meta.url), 'utf8');
const helpers = await readFile(new URL('../src/3d/gameLoopHelpers.js', import.meta.url), 'utf8');

function numberConstant(name) {
  const match = source.match(new RegExp(`${name}:\\s*([0-9.]+)`));
  assert.ok(match, `missing ${name}`);
  return Number(match[1]);
}

const cfg = Object.freeze({
  maxStamina: numberConstant('MAX_STAMINA'), sprintSpeed: numberConstant('SPRINT_SPEED_MPS'),
  sprintDrain: numberConstant('SPRINT_DRAIN_PER_SECOND'), restart: numberConstant('SPRINT_RESTART_STAMINA'),
  regen: numberConstant('STAMINA_REGEN_PER_SECOND'), regenDelay: numberConstant('STAMINA_REGEN_DELAY_SECONDS'),
  dodgeCost: numberConstant('DODGE_COST'), dodgeDuration: numberConstant('DODGE_DURATION_SECONDS'),
  dodgeSpeed: numberConstant('DODGE_SPEED_MPS'), collisionStep: numberConstant('MAX_COLLISION_STEP_METERS'),
  maxFrameDelta: numberConstant('MAX_FRAME_DELTA_SECONDS'), guardDrain: numberConstant('GUARD_DRAIN_PER_SECOND'),
  guardMoveMultiplier: numberConstant('GUARD_MOVE_SPEED_MULTIPLIER'), guardDamageMultiplier: numberConstant('GUARD_DAMAGE_MULTIPLIER'),
  guardStaminaDamageRatio: numberConstant('GUARD_STAMINA_DAMAGE_RATIO'), parryWindow: numberConstant('PARRY_WINDOW_SECONDS'),
  parryCost: numberConstant('PARRY_STAMINA_COST'),
});

assert.equal(cfg.maxStamina, 100);
assert.ok(cfg.sprintSpeed > 6 && cfg.sprintDrain > 0 && cfg.regen > 0);
assert.ok(cfg.restart > 0 && cfg.restart < cfg.maxStamina);
assert.ok(cfg.dodgeCost > 0 && cfg.dodgeCost < cfg.maxStamina && cfg.dodgeDuration > 0 && cfg.dodgeDuration < 0.75);
assert.ok(cfg.dodgeSpeed > cfg.sprintSpeed && cfg.collisionStep <= 0.5 && cfg.maxFrameDelta <= 0.1);
assert.ok(cfg.guardDrain > 0 && cfg.guardMoveMultiplier > 0 && cfg.guardMoveMultiplier < 1, 'guard must trade mobility/stamina for mitigation');
assert.ok(cfg.guardDamageMultiplier > 0 && cfg.guardDamageMultiplier < 0.5, 'guard must block a majority, not all, of ordinary damage');
assert.ok(cfg.guardStaminaDamageRatio > 0 && cfg.parryWindow > 0 && cfg.parryWindow <= 0.2 && cfg.parryCost > 0);

for (const fragment of [
  'groundCollider.getGroundHeight', 'playerCollider.resolveXZ',
  'Math.ceil(travelMeters / PLAYER_ACTION_CONFIG.MAX_COLLISION_STEP_METERS)',
  'runJumpDodgeRequested = Boolean(jumpRequested) && runIntent', 'canStartDodge()', 'startDodge(moveDirectionXZ)',
  "movementState = 'dodge'", "playAction('running', PLAYER_ACTION_CONFIG.DODGE_RUN_ANIMATION_TIMESCALE)",
  "gameEvents.on(EVENTS.PLAYER_DAMAGED, onIncomingDamage)", "payload.mitigation = 'parry'", "payload.mitigation = 'guard'",
  "movementState = 'guard'", "movementState = 'parry'", "globalThis.CustomEvent('aapw:player-motion'",
]) assert.ok(source.includes(fragment), `missing runtime contract: ${fragment}`);

assert.ok(input.includes("const GUARD_KEYS = new Set(['KeyQ'])"));
assert.ok(input.includes('GUARD_POINTER_BUTTON = 2'));
assert.ok(input.includes('guarding:'));
assert.ok(touch.includes("textContent = 'Savun'"));
assert.ok(touch.includes("setAttribute('aria-pressed', 'true')"));
assert.ok(helpers.includes('guarding: Boolean(keyboardAxes.guarding || joystickAxes.guarding)'));
assert.ok(helpers.includes('return { x: 0, z: 0, guarding }'));
assert.ok(!source.includes('EditorMaterialStudio'));
assert.ok(!source.includes('new THREE.CapsuleGeometry'));

function simulateSprint(seconds, dt = 1 / 60) {
  let stamina = cfg.maxStamina, exhausted = false, travelled = 0;
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) {
    const step = Math.min(dt, cfg.maxFrameDelta), sprinting = !exhausted && stamina > 0;
    travelled += (sprinting ? cfg.sprintSpeed : 0) * step;
    if (sprinting) { stamina = Math.max(0, stamina - cfg.sprintDrain * step); if (stamina <= 0) exhausted = true; }
  }
  return { stamina, exhausted, travelled };
}
const sprint = simulateSprint(1.5);
assert.ok(sprint.stamina < cfg.maxStamina - 30 && sprint.travelled > 10);
assert.equal(simulateSprint(10).stamina, 0);

const rawDamage = 20;
const guardedDamage = rawDamage * cfg.guardDamageMultiplier;
const guardStaminaCost = (rawDamage - guardedDamage) * cfg.guardStaminaDamageRatio;
assert.ok(guardedDamage <= 8 && guardStaminaCost > 0 && guardStaminaCost < cfg.parryCost,
  '20-point guard sample should meaningfully mitigate while remaining cheaper than a timed parry');

function dodgeTravel(delta) { return cfg.dodgeSpeed * Math.min(delta, cfg.maxFrameDelta); }
assert.ok(dodgeTravel(5) <= cfg.dodgeSpeed * cfg.maxFrameDelta + 1e-9);
assert.ok(Math.ceil(dodgeTravel(cfg.maxFrameDelta) / cfg.collisionStep) >= 2);

console.log(JSON.stringify({
  ok: true, contract: 'player-stamina-sprint-dodge-guard-parry', maxStamina: cfg.maxStamina,
  sprintSpeedMps: cfg.sprintSpeed, dodgeSpeedMps: cfg.dodgeSpeed, dodgeCost: cfg.dodgeCost,
  guard: { drainPerSecond: cfg.guardDrain, moveMultiplier: cfg.guardMoveMultiplier, damageMultiplier: cfg.guardDamageMultiplier,
    sample20DamageAfterGuard: guardedDamage, sample20GuardStaminaCost: guardStaminaCost },
  parry: { windowSeconds: cfg.parryWindow, staminaCost: cfg.parryCost },
}, null, 2));
