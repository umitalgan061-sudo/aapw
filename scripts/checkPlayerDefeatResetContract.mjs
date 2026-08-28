#!/usr/bin/env node
import fs from 'node:fs';

const playerPath = 'src/3d/gameplay/player.js';
const source = fs.readFileSync(playerPath, 'utf8');
const need = (ok, message) => {
  if (!ok) throw new Error(`[player-defeat-reset] ${message}`);
};
const sliceFunction = (name, nextName) => {
  const start = source.indexOf(`function ${name}`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : -1;
  need(start >= 0, `missing ${name}()`);
  return source.slice(start, end >= 0 ? end : undefined);
};

const reset = sliceFunction('resetAfterDefeat', 'onPlayerDied');
const died = sliceFunction('onPlayerDied', 'onIncomingDamage');
const disposeStart = source.indexOf('dispose()');
need(disposeStart >= 0, 'missing dispose()');
const dispose = source.slice(disposeStart);

for (const fragment of [
  'heightAboveGround = 0',
  'velocityY = 0',
  'isGrounded = true',
  'stamina = PLAYER_ACTION_CONFIG.MAX_STAMINA',
  'sprintExhausted = false',
  'regenDelayRemaining = 0',
  'poise = PLAYER_ACTION_CONFIG.MAX_POISE',
  'poiseRegenDelayRemaining = 0',
  'guardBreakRemaining = 0',
  'hitStaggerRemaining = 0',
  'dodgeRemaining = 0',
  'dodgeElapsed = 0',
  'dodgeCooldownRemaining = 0',
  'guarding = false',
  'wasGuardHeld = false',
  'parryWindowRemaining = 0',
  'parryFeedbackRemaining = 0',
  "attackKind = 'none'",
  'attackRemaining = 0',
  'attackElapsed = 0',
  'attackActive = false',
  'attackComboStep = 0',
  'attackCommitRemaining = 0',
  "bufferedAttackKind = 'none'",
  'attackBufferRemaining = 0',
  "lastDefenseResult = 'none'",
  "movementState = 'idle'",
]) need(reset.includes(fragment), `defeat reset must clear/restore: ${fragment}`);

need(reset.includes("playAction('idle', 1)"), 'defeat reset must return animation state to idle');
need(reset.includes('publishMotionTelemetry(true)'), 'defeat reset must force fresh telemetry after transient cleanup');
need(died.includes('interruptAttackForHit()'), 'death must terminate active attack windows before reset');
need(died.includes('defeatResetQueued = true'), 'death reset must be guarded against duplicate queueing');
need(died.includes('queueMicrotask'), 'death reset must remain deferred until current health/damage dispatch settles');
need(died.indexOf('interruptAttackForHit()') < died.indexOf('queueMicrotask'), 'attack interruption must precede deferred reset');
need(died.includes('if (defeatResetQueued) return'), 'duplicate PLAYER_DIED events must not enqueue multiple resets');
need(died.includes('if (!defeatResetQueued) return'), 'queued reset must be cancellable during teardown');
need(died.includes('resetAfterDefeat()'), 'queued death handler must route through canonical resetAfterDefeat');
need(dispose.includes('defeatResetQueued = false'), 'dispose must cancel a pending defeat reset before listener teardown');
need(source.includes('gameEvents.on(EVENTS.PLAYER_DIED, onPlayerDied)'), 'player must subscribe to canonical PLAYER_DIED event');
need(source.includes('gameEvents.off(EVENTS.PLAYER_DIED, onPlayerDied)'), 'player must unsubscribe from canonical PLAYER_DIED event');

const transientFamilies = Object.freeze([
  'airborne', 'stamina', 'poise', 'guard-break', 'hit-stagger', 'dodge', 'guard/parry', 'attack/combo-buffer', 'defense-result', 'animation/telemetry',
]);
console.log(JSON.stringify({
  contract: 'player-defeat-reset-v1',
  transientFamilies,
  rule: 'death interrupts active combat first, then atomically restores a clean grounded idle controller state on the microtask boundary; dispose cancels pending reset',
}, null, 2));
console.log('PLAYER_DEFEAT_RESET_CONTRACT_OK');
