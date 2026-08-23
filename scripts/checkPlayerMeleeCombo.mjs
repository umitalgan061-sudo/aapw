#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const player = await readFile(new URL('../src/3d/gameplay/player.js', import.meta.url), 'utf8');
const input = await readFile(new URL('../src/3d/input.js', import.meta.url), 'utf8');
const touch = await readFile(new URL('../src/3d/ui/touchJoystick.js', import.meta.url), 'utf8');
const playerConfig = await readFile(new URL('../src/3d/gameplay/playerConfig.js', import.meta.url), 'utf8');
function numberConstant(name) { const match = player.match(new RegExp(`${name}:\\s*([0-9.]+)`)); assert.ok(match, `missing ${name}`); return Number(match[1]); }
const cfg = Object.freeze({
	lightCost: numberConstant('LIGHT_ATTACK_STAMINA_COST'), heavyCost: numberConstant('HEAVY_ATTACK_STAMINA_COST'), lightSeconds: numberConstant('LIGHT_ATTACK_SECONDS'), heavySeconds: numberConstant('HEAVY_ATTACK_SECONDS'),
	lightActiveStart: numberConstant('LIGHT_ATTACK_ACTIVE_START_SECONDS'), lightActiveEnd: numberConstant('LIGHT_ATTACK_ACTIVE_END_SECONDS'), heavyActiveStart: numberConstant('HEAVY_ATTACK_ACTIVE_START_SECONDS'), heavyActiveEnd: numberConstant('HEAVY_ATTACK_ACTIVE_END_SECONDS'),
	bufferSeconds: numberConstant('ATTACK_COMBO_BUFFER_SECONDS'), maxSteps: numberConstant('ATTACK_COMBO_MAX_STEPS'), lightReach: numberConstant('LIGHT_ATTACK_REACH_METERS'), heavyReach: numberConstant('HEAVY_ATTACK_REACH_METERS'), lightDamageScale: numberConstant('LIGHT_ATTACK_DAMAGE_SCALE'), heavyDamageScale: numberConstant('HEAVY_ATTACK_DAMAGE_SCALE'),
});
assert.ok(cfg.lightCost > 0 && cfg.heavyCost > cfg.lightCost && cfg.heavyCost < 40); assert.ok(cfg.lightSeconds > 0.25 && cfg.lightSeconds < cfg.heavySeconds && cfg.heavySeconds < 1); assert.ok(cfg.lightActiveStart > 0 && cfg.lightActiveEnd > cfg.lightActiveStart && cfg.lightActiveEnd < cfg.lightSeconds); assert.ok(cfg.heavyActiveStart > 0 && cfg.heavyActiveEnd > cfg.heavyActiveStart && cfg.heavyActiveEnd < cfg.heavySeconds); assert.ok(cfg.bufferSeconds > 0.1 && cfg.bufferSeconds < cfg.lightSeconds); assert.equal(cfg.maxSteps, 3); assert.ok(cfg.heavyReach > cfg.lightReach && cfg.heavyDamageScale > cfg.lightDamageScale);
for (const fragment of ["const COMBAT_INPUT_EVENT = 'aapw:player-combat-input'", "const ATTACK_WINDOW_EVENT = 'aapw:player-attack-window'", 'function canStartAttack(kind)', 'function startAttack(kind, chained = false)', "movementState = `attack-${kind}`", "publishAttackWindow('active-start')", "publishAttackWindow('active-end')", "attackComboStep = chained ? Math.min(PLAYER_ACTION_CONFIG.ATTACK_COMBO_MAX_STEPS, previousComboStep + 1) : 1", 'attackRemaining <= 0 && !guarding', 'globalThis.removeEventListener?.(COMBAT_INPUT_EVENT, onCombatInput)']) assert.ok(player.includes(fragment), `missing player melee contract: ${fragment}`);
assert.ok(/function updateAttack\(dt(?:,\s*[^)]+)?\)/.test(player), 'attack updater must preserve dt while allowing additive live-state inputs');
assert.match(player, /ATTACK_WINDUP_TURN_MULTIPLIER:\s*0\.68/, 'bounded windup steering multiplier missing');
assert.match(player, /function updateAttack\(dt,\s*moveDirectionXZ\)/, 'attack update must receive live movement intent');
assert.match(player, /previousElapsed\s*<\s*tuning\.activeStart\s*&&\s*hasMovementInput/, 'windup steering must be limited to pre-active frames');
assert.match(player, /turnToward\(moveDirectionXZ\.x,\s*moveDirectionXZ\.z,\s*dt\s*\*\s*PLAYER_ACTION_CONFIG\.ATTACK_WINDUP_TURN_MULTIPLIER\)/, 'windup steering must reuse canonical turn path');
assert.match(player, /else if \(attackRemaining > 0\) \{ guarding = false; updateAttack\(dt, moveDirectionXZ\); \}/, 'attack state must receive canonical movement intent');
assert.match(player, /moveBy\(Math\.sin\(model\.rotation\.y\),\s*Math\.cos\(model\.rotation\.y\)/, 'melee commit must follow resolved facing');
assert.ok(!/activeNow[^\n]*turnToward/.test(player), 'active frames must not gain free attack steering');
assert.ok(!/recovery[^\n]*turnToward/.test(player), 'recovery frames must not gain free attack steering');
assert.match(player, /playerCollider\.resolveXZ/, 'canonical collider resolution must remain');
assert.match(player, /groundCollider\.getGroundHeight/, 'canonical ground coupling must remain');
assert.match(player, /const targetYaw = Math\.atan2\(directionX, directionZ\);[\s\S]*?Math\.min\(1, PLAYER_CONFIG\.TURN_RATE_RADIANS_PER_SECOND \* delta\)\);/, 'canonical shortest-angle turn math missing');
for (const fragment of ["const LIGHT_ATTACK_KEYS = new Set(['KeyE'])", "const HEAVY_ATTACK_KEYS = new Set(['KeyR'])", "const GAMEPAD_BUTTON = Object.freeze({", 'JUMP: 0', 'LIGHT: 2', 'HEAVY: 3', 'export function samplePlayerGamepad(', 'previousButtons = {}', 'const sample = samplePlayerGamepad(gamepad, this._gamepadButtons', "emitPlayerCombatIntent('light', 'mouse')", "emitPlayerCombatIntent('light', 'gamepad')", "emitPlayerCombatIntent('heavy', 'gamepad')", "button, a, input, textarea, select"]) assert.ok(input.includes(fragment), `missing input parity contract: ${fragment}`);
assert.ok(/export function samplePlayerGamepad\(gamepad, previousButtons = \{\}(?:, [^)]+)?\)/.test(input), 'gamepad sampler must preserve gamepad + previous-button edge-state inputs while allowing additive state parameters');
assert.ok(!input.includes("gamepad?.buttons?.[0]?.pressed"), 'legacy A-as-light direct gamepad polling must stay removed');
for (const fragment of ["className = 'g3d-touch-light-attack-button'", "className = 'g3d-touch-heavy-attack-button'", "emitPlayerCombatIntent('light', 'touch')", "emitPlayerCombatIntent('heavy', 'touch')", "setAttribute('aria-label', 'Hafif saldırı')", "setAttribute('aria-label', 'Ağır saldırı')"]) assert.ok(touch.includes(fragment), `missing mobile melee contract: ${fragment}`);
for (const clip of ['idle', 'walking', 'running']) assert.ok(playerConfig.includes(`${clip}: 'assets/animations/peasant_girl/${clip}.fbx'`), `missing shipped ${clip} animation source`);
assert.ok(!playerConfig.match(/\battack\s*:/i), 'do not invent an attack clip absent from the shipped asset family'); assert.ok(!player.includes('EditorMaterialStudio')); assert.ok(!player.includes('CapsuleGeometry')); assert.ok(!player.includes('npc.js'));
console.log(JSON.stringify({ ok: true, contract: 'player-melee-combo-input-window', attack: cfg, windupSteering: { turnMultiplier: 0.68, preActiveOnly: true, activeHoming: false }, inputs: { keyboard: ['KeyE', 'KeyR'], mouse: 'button0-light', gamepad: ['A/button0-jump', 'X/button2-light', 'Y/button3-heavy'], touch: ['light', 'heavy'] }, assetPolicy: { newModel: false, fabricatedAttackClip: false, canonicalAnimationConfig: 'src/3d/gameplay/playerConfig.js', sharedMaterialCoreUnchanged: true }, ownership: { npcDamageConsumerModified: false, terrainModified: false, rpgSemanticsModified: false } }, null, 2));
