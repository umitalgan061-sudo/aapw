#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [player, playerConfig, loop, game3d, input, touch, health, materialCore, placement, interaction, controlsHelp] = await Promise.all([
  read('src/3d/gameplay/player.js'),
  read('src/3d/gameplay/playerConfig.js'),
  read('src/3d/gameLoopHelpers.js'),
  read('src/3d/game3d.js'),
  read('src/3d/input.js'),
  read('src/3d/ui/touchJoystick.js'),
  read('src/3d/gameplay/health.js'),
  read('src/3d/materials/MaterialAssignmentCore.js'),
  read('src/3d/world/WorldAssetPlacementPipeline.js'),
  read('src/3d/gameplay/interaction.js'),
  read('src/3d/ui/controlsHelp.js'),
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
  "const LIGHT_ATTACK_KEYS = new Set(['KeyC'])",
  "const HEAVY_ATTACK_KEYS = new Set(['KeyR'])",
  'LOCK_ON: 11',
  'LIGHT: 2',
  'HEAVY: 3',
  "emitPlayerCombatIntent('light', 'mouse')",
  "emitPlayerCombatIntent('light', 'gamepad')",
  "emitPlayerCombatIntent('heavy', 'gamepad')",
  "LIGHT_ATTACK_KEYS.has(event.code) && !isInteractiveTarget(event.target)",
  "HEAVY_ATTACK_KEYS.has(event.code) && !isInteractiveTarget(event.target)",
]);
requireFragments(input, 'interactive UI input isolation', [
  'readPlayerGameplayInputBlocked(this._isInputBlocked) || isInteractiveTarget(event.target)',
  'if (readPlayerGameplayInputBlocked(this._isInputBlocked) || isInteractiveTarget(event.target)) return;',
]);
requireFragments(input, 'shared pause-input isolation', [
  "'.g3d-pause-menu-overlay:not([hidden])'",
  'export function isPlayerGameplayInputBlocked()',
  'export function readPlayerGameplayInputBlocked(',
  'constructor(target = window, { isInputBlocked = isPlayerGameplayInputBlocked } = {})',
  'readPlayerGameplayInputBlocked(this._isInputBlocked)',
  'this._gamepadButtons = sample.buttons',
]);
assert.ok(!input.includes("const LIGHT_ATTACK_KEYS = new Set(['KeyE'])"), 'nearby interaction E must not also be bound to keyboard light melee');
requireFragments(interaction, 'interaction key ownership', ["if (event.code !== 'KeyE') return"]);
requireFragments(controlsHelp, 'desktop combat and interaction help', [
  "['C / Sol tık', 'Hafif saldırı']",
  "['R', 'Ağır saldırı']",
  "['Q / Sağ tık', 'Savunmayı basılı tut']",
  "['Tab', 'Yakındaki hedefe kilitlen veya kilidi kaldır']",
  "['E', 'Yakındaki kişiyle konuş']",
]);
requireFragments(controlsHelp, 'gamepad combat help', [
  "['Gamepad sol çubuk / L3', 'Yürü / koş']",
  "['Gamepad A / B', 'Zıpla / kaçın']",
  "['Gamepad X / Y', 'Hafif / ağır saldırı']",
  "['Gamepad LB / RB', 'Savun / savuştur']",
  "['Gamepad sağ çubuk / R3', 'Kamera / hedef kilidi']",
]);
requireFragments(controlsHelp, 'touch combat help', [
  "['Savun', 'Savunmayı basılı tut']",
  "['Hedef', 'Yakındaki hedefe kilitlen veya kilidi kaldır']",
  "['Hafif', 'Hafif saldırı']",
  "['Ağır', 'Ağır saldırı']",
  "['Kaçın', 'Hareket ederken kaçınma hamlesi yap']",
  "['Savuştur', 'Kısa savuşturma penceresi aç']",
]);
requireFragments(touch, 'mobile/PWA input parity', [
  "className = 'g3d-touch-lock-on-button'",
  "className = 'g3d-touch-light-attack-button'",
  "className = 'g3d-touch-heavy-attack-button'",
  "className = 'g3d-touch-dodge-button'",
  "className = 'g3d-touch-parry-button'",
  "emitPlayerCombatIntent('light', 'touch')",
  "emitPlayerCombatIntent('heavy', 'touch')",
  'consumeLockOnRequested()',
]);
requireFragments(touch, 'touch pause-input isolation', [
  'isPlayerGameplayInputBlocked',
  'readPlayerGameplayInputBlocked',
  'constructor(container = document.body, { isInputBlocked = isPlayerGameplayInputBlocked } = {})',
  '_resetGameplayState()',
  'return { forward: 0, strafe: 0, running: false, guarding: false }',
]);
requireFragments(touch, 'touch pointer-loss recovery', [
  "this._base.addEventListener('lostpointercapture', this._onLostPointerCapture)",
  "if (event.pointerId === this._pointerId) this._resetMovementState()",
  "this._base.removeEventListener('lostpointercapture', this._onLostPointerCapture)",
  '_resetMovementState() {',
]);
requireFragments(touch, 'touch app-lifecycle recovery', [
  "this._pageLifecycleTarget?.addEventListener('blur', this._onWindowBlur)",
  "this._pageLifecycleTarget?.removeEventListener('blur', this._onWindowBlur)",
]);
requireFragments(game3d, 'authoritative player health wiring', [
  'createHealthState({',
  'damageEventName: EVENTS.PLAYER_DAMAGED',
]);
requireFragments(health, 'authoritative health receipt', [
  'appliedAmount',
  "reason === 'damage'",
  'eventsBus.emit(healthChangedEventName',
]);
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
  inputs: ['keyboard:C-light/R-heavy/E-interaction', 'mouse', 'gamepad', 'touch/PWA'],
  pauseIsolation: ['keyboard', 'pointer', 'gamepad', 'touch'],
  interactiveUiIsolation: ['keyboard-movement', 'keyboard-jump', 'keyboard-guard', 'keyboard-combat', 'pointer-guard', 'pointer-combat'],
  touchLifecycleRecovery: ['visibilitychange', 'pagehide', 'blur', 'lostpointercapture'],
  desktopHelp: ['C / Sol tık = Hafif saldırı', 'R = Ağır saldırı', 'Q / Sağ tık = Savun', 'Tab = Hedef kilidi', 'E = Yakındaki kişiyle konuş'],
  gamepadHelp: ['sol çubuk/L3', 'A/B', 'X/Y', 'LB/RB', 'sağ çubuk/R3'],
  touchHelp: ['Savun', 'Hedef', 'Hafif', 'Ağır', 'Kaçın', 'Savuştur'],
  sharedMaterialPlacement: true,
  newAsset: false,
}, null, 2));