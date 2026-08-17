import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/3d/gameplay/player.js', import.meta.url), 'utf8');

function numberConstant(name) {
  const match = source.match(new RegExp(`${name}:\\s*([0-9.]+)`));
  assert.ok(match, `missing ${name}`);
  return Number(match[1]);
}

const cfg = Object.freeze({
  maxStamina: numberConstant('MAX_STAMINA'),
  sprintSpeed: numberConstant('SPRINT_SPEED_MPS'),
  sprintDrain: numberConstant('SPRINT_DRAIN_PER_SECOND'),
  restart: numberConstant('SPRINT_RESTART_STAMINA'),
  regen: numberConstant('STAMINA_REGEN_PER_SECOND'),
  regenDelay: numberConstant('STAMINA_REGEN_DELAY_SECONDS'),
  dodgeWindow: numberConstant('DODGE_DOUBLE_TAP_WINDOW_SECONDS'),
  dodgeCost: numberConstant('DODGE_COST'),
  dodgeDuration: numberConstant('DODGE_DURATION_SECONDS'),
  dodgeSpeed: numberConstant('DODGE_SPEED_MPS'),
  dodgeCooldown: numberConstant('DODGE_COOLDOWN_SECONDS'),
  collisionStep: numberConstant('MAX_COLLISION_STEP_METERS'),
  maxFrameDelta: numberConstant('MAX_FRAME_DELTA_SECONDS'),
});

assert.equal(cfg.maxStamina, 100);
assert.ok(cfg.sprintSpeed > 6, 'sprint must be materially faster than walk');
assert.ok(cfg.sprintDrain > 0 && cfg.regen > 0);
assert.ok(cfg.restart > 0 && cfg.restart < cfg.maxStamina);
assert.ok(cfg.dodgeCost > 0 && cfg.dodgeCost < cfg.maxStamina);
assert.ok(cfg.dodgeDuration > 0 && cfg.dodgeDuration < 0.75);
assert.ok(cfg.dodgeSpeed > cfg.sprintSpeed);
assert.ok(cfg.collisionStep <= 0.5, 'dodge/sprint collision stepping must stay bounded');
assert.ok(cfg.maxFrameDelta <= 0.1, 'browser stalls must not create large gameplay steps');

for (const fragment of [
  'groundCollider.getGroundHeight',
  'playerCollider.resolveXZ',
  'Math.ceil(travelMeters / PLAYER_ACTION_CONFIG.MAX_COLLISION_STEP_METERS)',
  'const runJumpDodgeRequested = Boolean(jumpRequested) && runIntent',
  'canStartDodge()',
  'startDodge(moveDirectionXZ)',
  "movementState = 'dodge'",
  "playAction('running', PLAYER_ACTION_CONFIG.DODGE_RUN_ANIMATION_TIMESCALE)",
  "globalThis.CustomEvent('aapw:player-motion'",
]) assert.ok(source.includes(fragment), `missing runtime contract: ${fragment}`);

assert.ok(!source.includes('EditorMaterialStudio'), 'runtime player must not import editor-only Material Studio');
assert.ok(!source.includes('new THREE.CapsuleGeometry'), 'player controller must not introduce primitive placeholder geometry');

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
assert.ok(sprint.stamina < cfg.maxStamina - 30, 'sprint must consume substantial stamina');
assert.ok(sprint.travelled > 10, 'sprint must create real world displacement');
const exhausted = simulateSprint(10);
assert.equal(exhausted.stamina, 0); assert.equal(exhausted.exhausted, true);

function simulateRecovery(initial, seconds, dt = 1 / 60) {
  let stamina = initial, delay = cfg.regenDelay;
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) { const step = Math.min(dt, cfg.maxFrameDelta); delay = Math.max(0, delay - step); if (delay <= 0) stamina = Math.min(cfg.maxStamina, stamina + cfg.regen * step); }
  return stamina;
}
assert.equal(simulateRecovery(10, cfg.regenDelay / 2), 10, 'regen delay must suppress early recovery');
assert.ok(simulateRecovery(10, cfg.regenDelay + 1) > 25, 'stamina must recover after delay');
function dodgeTravel(delta) { const dt = Math.min(delta, cfg.maxFrameDelta); return cfg.dodgeSpeed * dt; }
assert.ok(dodgeTravel(5) <= cfg.dodgeSpeed * cfg.maxFrameDelta + 1e-9, 'large frame must be capped');
assert.ok(Math.ceil(dodgeTravel(cfg.maxFrameDelta) / cfg.collisionStep) >= 2, 'max-frame dodge must resolve collision in multiple substeps');
const availableDodges = Math.floor(cfg.maxStamina / cfg.dodgeCost);
assert.ok(availableDodges >= 3 && availableDodges <= 4, 'dodge cost should prevent spam while allowing a short chain');
console.log(JSON.stringify({ ok: true, contract: 'player-stamina-sprint-dodge', maxStamina: cfg.maxStamina, sprintSpeedMps: cfg.sprintSpeed, dodgeSpeedMps: cfg.dodgeSpeed, dodgeCost: cfg.dodgeCost, collisionStepMeters: cfg.collisionStep, maxFrameDeltaSeconds: cfg.maxFrameDelta, sprintAfter1_5s: sprint, availableDodges }, null, 2));
