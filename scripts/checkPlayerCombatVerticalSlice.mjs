#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [player, playerConfig, loop, input, touch, health, materialCore, placement] = await Promise.all([
  read('src/3d/gameplay/player.js'),
  read('src/3d/gameplay/playerConfig.js'),
  read('src/3d/gameLoopHelpers.js'),
  read('src/3d/input.js'),
  read('src/3d/ui/touchJoystick.js'),
  read('src/3d/gameplay/health.js'),
  read('src/3d/materials/MaterialAssignmentCore.js'),
  read('src/3d/world/WorldAssetPlacementPipeline.js'),
]);

const requireFragments = (source, label, fragments) => {
  for (const fragment of fragments) assert.ok(source.includes(fragment), `${label} missing: ${fragment}`);
};

requireFragments(playerConfig, 'asset-first player config', [
  "MODEL_URL: 'assets/models/characters/peasant_girl.fbx'",
  "idle: 'assets/animations/peasant_girl/idle.fbx'",
  "walking: 'assets/animations/peasant_girl/walking.fbx'",
  "running: 'assets/animations/peasant_girl/running.fbx'",
]);
requireFragments(player, 'player state machine', [
  "const COMBAT_INPUT_EVENT = 'aapw:player-combat-input'",
  "const ATTACK_WINDOW_EVENT = 'aapw:player-attack-window'",
  "const COMBAT_FEEDBACK_EVENT = 'aapw:player-combat-feedback'",
  'MAX_POISE: 100',
  'function startAttack(kind, chained = false)',
  "publishAttackWindow('active-start')",
  "publishAttackWindow('active-end')",
  'function isDodgeInvulnerable()',
  'function triggerGuardBreak()',
  'function triggerHitStagger()',
  'gameEvents.on(EVENTS.PLAYER_DAMAGED, onIncomingDamage)',
  'playerCollider.resolveXZ',
  'groundCollider.getGroundHeight',
  'integrateJumpArc(',
]);
requireFragments(loop, 'third-person lock-on integration', [
  'export const PLAYER_LOCK_ON_CONFIG',
  'export function createPlayerLockOnController',
  'export function updatePlayerLockOn(state)',
  'candidates: state.npcs ?? []',
  'applyPlayerLockFacing(state.player.object3D',
  'updatePlayerLockOn(state);',
]);
requireFragments(input, 'desktop/gamepad parity', [
  "const LOCK_ON_KEYS = new Set(['Tab'])",
  "const LIGHT_ATTACK_KEYS = new Set(['KeyE'])",
  "const HEAVY_ATTACK_KEYS = new Set(['KeyR'])",
  'LOCK_ON: 11',
  'LIGHT: 2',
  'HEAVY: 3',
  "emitPlayerCombatIntent('light', 'mouse')",
  "emitPlayerCombatIntent('light', 'gamepad')",
  "emitPlayerCombatIntent('heavy', 'gamepad')",
]);
requireFragments(touch, 'mobile/PWA input parity', [
  "className = 'g3d-touch-lock-on-button'",
  "className = 'g3d-touch-light-attack-button'",
  "className = 'g3d-touch-heavy-attack-button'",
  "emitPlayerCombatIntent('light', 'touch')",
  "emitPlayerCombatIntent('heavy', 'touch')",
  'consumeLockOnRequested()',
]);
requireFragments(health, 'authoritative health receipt', ['appliedAmount', 'PLAYER_DAMAGED']);
requireFragments(materialCore, 'shared material core', ['validateMaterialAssignment']);
requireFragments(placement, 'shared placement pipeline', ['MaterialAssignmentCore']);

assert.ok(!player.includes('EditorMaterialStudio'), 'runtime player must not import editor-only Material Studio UI');
assert.ok(!loop.includes('EditorMaterialStudio'), 'runtime loop must not import editor-only Material Studio UI');
assert.ok(!player.includes('CapsuleGeometry'), 'player production path must not introduce primitive placeholder geometry');
assert.ok(!loop.includes('npc.update('), 'player lock-on adapter must not own NPC AI updates');

console.log(JSON.stringify({
  ok: true,
  contract: 'player-combat-vertical-slice-composition',
  chain: ['asset+animation', 'spawn+ground+collider', 'input', 'movement+stamina+poise', 'dodge+guard+parry', 'melee-combo', 'lock-on', 'damage+feedback'],
  inputs: ['keyboard', 'mouse', 'gamepad', 'touch/PWA'],
  sharedMaterialPlacement: true,
  newAsset: false,
}, null, 2));
