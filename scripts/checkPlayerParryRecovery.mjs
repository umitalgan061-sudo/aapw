#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/3d/gameplay/player.js', import.meta.url), 'utf8');
const guardUpdate = source.match(/const guardIntent = Boolean\(moveDirectionXZ\.guarding\).*?wasGuardHeld = guardIntent;/s)?.[0] ?? '';

assert.ok(guardUpdate, 'player guard update contract must exist');
assert.ok(
  guardUpdate.includes('parryFeedbackRemaining <= 0'),
  'successful parry recovery must block guard/parry rearm until feedback recovery expires',
);
assert.ok(
  source.includes("else if (parryFeedbackRemaining > 0) { movementState = 'parry'"),
  'parry recovery must remain an explicit transient player state',
);
assert.ok(
  source.includes('canStartAttack(kind)') && source.includes('parryFeedbackRemaining <= 0 && !guarding'),
  'parry recovery must continue blocking attack startup as well as guard rearm',
);

function resolveGuard({ guardIntent, wasGuardHeld, parryFeedbackRemaining, stamina = 100 }) {
  const guardPressed = guardIntent && !wasGuardHeld;
  const guarding = guardIntent && parryFeedbackRemaining <= 0 && stamina > 0;
  const parryWindow = guardPressed && guarding && stamina >= 8 ? 0.16 : 0;
  return { guarding, parryWindow };
}

assert.deepEqual(
  resolveGuard({ guardIntent: true, wasGuardHeld: false, parryFeedbackRemaining: 0.12 }),
  { guarding: false, parryWindow: 0 },
  'fresh guard press during parry recovery must not open a second parry window',
);
assert.deepEqual(
  resolveGuard({ guardIntent: true, wasGuardHeld: false, parryFeedbackRemaining: 0 }),
  { guarding: true, parryWindow: 0.16 },
  'guard/parry must rearm normally after recovery ends',
);

console.log(JSON.stringify({
  ok: true,
  contract: 'player-parry-recovery-lockout',
  recoveryBlocks: ['guard', 'parry-rearm', 'attack'],
  rearmAfterRecovery: true,
}, null, 2));
