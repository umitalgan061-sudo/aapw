#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { KeyboardInput, readPlayerGameplayInputBlocked } from '../src/3d/input.js';
import { TouchJoystick } from '../src/3d/ui/touchJoystick.js';

const player = await readFile(new URL('../src/3d/gameplay/player.js', import.meta.url), 'utf8');
const input = await readFile(new URL('../src/3d/input.js', import.meta.url), 'utf8');
const touch = await readFile(new URL('../src/3d/ui/touchJoystick.js', import.meta.url), 'utf8');
const playerConfig = await readFile(new URL('../src/3d/gameplay/playerConfig.js', import.meta.url), 'utf8');
const interaction = await readFile(new URL('../src/3d/gameplay/interaction.js', import.meta.url), 'utf8');
const controlsHelp = await readFile(new URL('../src/3d/ui/controlsHelp.js', import.meta.url), 'utf8');
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
for (const fragment of ["const LIGHT_ATTACK_KEYS = new Set(['KeyC'])", "const HEAVY_ATTACK_KEYS = new Set(['KeyR'])", "const GAMEPAD_BUTTON = Object.freeze({", 'JUMP: 0', 'LIGHT: 2', 'HEAVY: 3', 'export function samplePlayerGamepad(', 'previousButtons = {}', 'const sample = samplePlayerGamepad(gamepad, this._gamepadButtons', "emitPlayerCombatIntent('light', 'mouse')", "emitPlayerCombatIntent('light', 'gamepad')", "emitPlayerCombatIntent('heavy', 'gamepad')", "button, a, input, textarea, select", "LIGHT_ATTACK_KEYS.has(event.code) && !isInteractiveTarget(event.target)", "HEAVY_ATTACK_KEYS.has(event.code) && !isInteractiveTarget(event.target)", ".g3d-pause-menu-overlay:not([hidden])", 'export function isPlayerGameplayInputBlocked()', 'export function readPlayerGameplayInputBlocked(', 'constructor(target = window, { isInputBlocked = isPlayerGameplayInputBlocked } = {})', 'if (event.repeat === true && !wasHeld) return;', 'this._visibilityTarget = globalThis.document?.addEventListener ? globalThis.document : target', "this._visibilityTarget.addEventListener('visibilitychange', this._onVisibilityChange)", 'if (readPlayerGameplayInputBlocked(this._isInputBlocked)) return;', '_pollGamepad(inputBlocked = readPlayerGameplayInputBlocked(this._isInputBlocked))', 'if (inputBlocked) {']) assert.ok(input.includes(fragment), `missing input parity/lifecycle contract: ${fragment}`);
assert.equal(readPlayerGameplayInputBlocked(() => { throw new Error('blocked predicate failure'); }), true, 'input blocker predicate failures must fail closed');
assert.ok(!input.includes("const LIGHT_ATTACK_KEYS = new Set(['KeyE'])"), 'E is reserved for nearby interaction and must not also emit keyboard melee');
assert.ok(interaction.includes("if (event.code !== 'KeyE') return"), 'interaction controller must retain E as its canonical nearby-interaction key');
assert.ok(controlsHelp.includes("['E', 'Yakındaki kişiyle konuş']"), 'desktop controls help must keep E documented as nearby interaction');
assert.ok(/export function samplePlayerGamepad\(gamepad, previousButtons = \{\}(?:, [^)]+)?\)/.test(input), 'gamepad sampler must preserve gamepad + previous-button edge-state inputs while allowing additive state parameters');
assert.ok(!input.includes("gamepad?.buttons?.[0]?.pressed"), 'legacy A-as-light direct gamepad polling must stay removed');
for (const fragment of ["className = 'g3d-touch-light-attack-button'", "className = 'g3d-touch-heavy-attack-button'", "emitPlayerCombatIntent('light', 'touch')", "emitPlayerCombatIntent('heavy', 'touch')", "setAttribute('aria-label', 'Hafif saldırı')", "setAttribute('aria-label', 'Ağır saldırı')", 'constructor(container = document.body, { isInputBlocked = isPlayerGameplayInputBlocked } = {})', 'readPlayerGameplayInputBlocked(this._isInputBlocked)', 'this._visibilityTarget = globalThis.document?.addEventListener ? globalThis.document : null', 'this._pageLifecycleTarget = globalThis.window?.addEventListener ? globalThis.window : null', "this._visibilityTarget?.addEventListener('visibilitychange', this._onVisibilityChange)", "this._pageLifecycleTarget?.addEventListener('pagehide', this._onPageHide)", '_resetGameplayState()', 'return { forward: 0, strafe: 0, running: false, guarding: false }']) assert.ok(touch.includes(fragment), `missing mobile melee/pause/lifecycle contract: ${fragment}`);
for (const clip of ['idle', 'walking', 'running']) assert.ok(playerConfig.includes(`${clip}: 'assets/animations/peasant_girl/${clip}.fbx'`), `missing shipped ${clip} animation source`);
assert.ok(!playerConfig.match(/\battack\s*:/i), 'do not invent an attack clip absent from the shipped asset family'); assert.ok(!player.includes('EditorMaterialStudio')); assert.ok(!player.includes('CapsuleGeometry')); assert.ok(!player.includes('npc.js'));

const previousDispatchEvent = globalThis.dispatchEvent;
const previousCustomEvent = globalThis.CustomEvent;
const previousDocument = globalThis.document;
const previousWindow = globalThis.window;
if (typeof globalThis.CustomEvent !== 'function') globalThis.CustomEvent = class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };
const keyboardIntents = [];
globalThis.dispatchEvent = (event) => { if (event?.type === 'aapw:player-combat-input') keyboardIntents.push(event.detail); return true; };
class FakeClassList {
	constructor() { this.values = new Set(); }
	add(value) { this.values.add(value); }
	remove(value) { this.values.delete(value); }
	toggle(value, force) { if (force ?? !this.values.has(value)) this.values.add(value); else this.values.delete(value); }
}
class FakeElement extends EventTarget {
	constructor(tag = 'div') { super(); this.tagName = tag.toUpperCase(); this.style = {}; this.classList = new FakeClassList(); this.attributes = new Map(); this.children = []; this.capturedPointerId = null; this.className = ''; this.textContent = ''; }
	appendChild(child) { this.children.push(child); return child; }
	setAttribute(name, value) { this.attributes.set(name, String(value)); }
	getAttribute(name) { return this.attributes.get(name) ?? null; }
	setPointerCapture(id) { this.capturedPointerId = id; }
	hasPointerCapture(id) { return this.capturedPointerId === id; }
	releasePointerCapture(id) { if (this.capturedPointerId === id) this.capturedPointerId = null; }
	remove() {}
}
class FakeDocument extends EventTarget {
	constructor() { super(); this.hidden = false; this.body = new FakeElement('body'); }
	createElement(tag) { return new FakeElement(tag); }
	querySelector() { return null; }
}
class FakeKeyTarget extends EventTarget {
	constructor(interactive = false) { super(); this.hidden = false; this.interactive = interactive; }
	closest() { return this.interactive ? this : null; }
}
function dispatchKey(target, type, code, repeat = false) { const event = new Event(type, { cancelable: true }); Object.defineProperties(event, { code: { value: code }, repeat: { value: repeat } }); target.dispatchEvent(event); return event; }
function dispatchPointer(target, type, button, pointerId = 1, clientX = 0, clientY = 0) { const event = new Event(type, { cancelable: true }); Object.defineProperties(event, { button: { value: button }, pointerId: { value: pointerId }, clientX: { value: clientX }, clientY: { value: clientY } }); target.dispatchEvent(event); return event; }
const lifecycleDocument = new FakeDocument();
const lifecycleWindow = new EventTarget();
globalThis.document = lifecycleDocument;
globalThis.window = lifecycleWindow;
const worldTarget = new FakeKeyTarget(false), interactiveTarget = new FakeKeyTarget(true), pausedTarget = new FakeKeyTarget(false);
let pauseBlocked = true;
const worldInput = new KeyboardInput(worldTarget), interactiveInput = new KeyboardInput(interactiveTarget), pausedInput = new KeyboardInput(pausedTarget, { isInputBlocked: () => pauseBlocked });
let touchInput = null;
try {
	dispatchKey(worldTarget, 'keydown', 'KeyE');
	assert.equal(keyboardIntents.length, 0, 'E must remain interaction-only and emit no keyboard combat intent');
	dispatchKey(worldTarget, 'keyup', 'KeyE');
	dispatchKey(worldTarget, 'keydown', 'KeyC');
	assert.deepEqual(keyboardIntents, [{ kind: 'light', source: 'keyboard' }], 'C must emit one keyboard light-attack intent');
	dispatchKey(worldTarget, 'keydown', 'KeyC');
	assert.equal(keyboardIntents.length, 1, 'held C must stay edge-triggered');
	dispatchKey(worldTarget, 'keyup', 'KeyC');
	dispatchKey(worldTarget, 'keydown', 'KeyC');
	assert.deepEqual(keyboardIntents.at(-1), { kind: 'light', source: 'keyboard' }, 'C must re-arm after keyup');
	dispatchKey(worldTarget, 'keyup', 'KeyC');
	dispatchKey(worldTarget, 'keydown', 'KeyR');
	assert.deepEqual(keyboardIntents.at(-1), { kind: 'heavy', source: 'keyboard' }, 'R heavy attack mapping must stay unchanged');
	const beforeInteractive = keyboardIntents.length;
	dispatchKey(interactiveTarget, 'keydown', 'KeyC');
	dispatchKey(interactiveTarget, 'keyup', 'KeyC');
	dispatchKey(interactiveTarget, 'keydown', 'KeyR');
	assert.equal(keyboardIntents.length, beforeInteractive, 'focused interactive DOM controls must suppress keyboard melee intents');

	// A PWA/browser visibility transition must clear held state on the document event target. When
	// the page returns, OS key-repeat from a key that remained physically held is not a fresh edge.
	dispatchKey(worldTarget, 'keydown', 'KeyW');
	dispatchKey(worldTarget, 'keydown', 'Space');
	dispatchKey(worldTarget, 'keydown', 'Tab');
	const beforeVisibilityRepeat = keyboardIntents.length;
	lifecycleDocument.hidden = true;
	lifecycleDocument.dispatchEvent(new Event('visibilitychange'));
	assert.deepEqual(worldInput.getAxes(), { forward: 0, strafe: 0, running: false, jumpRequested: false, lockOnRequested: false, guarding: false, lookX: 0, lookY: 0, cameraZoom: 0, lookDeltaSeconds: 0 }, 'document visibility loss must clear keyboard movement and queued action edges');
	lifecycleDocument.hidden = false;
	dispatchKey(worldTarget, 'keydown', 'KeyW', true);
	dispatchKey(worldTarget, 'keydown', 'KeyC', true);
	dispatchKey(worldTarget, 'keydown', 'Space', true);
	dispatchKey(worldTarget, 'keydown', 'Tab', true);
	const repeatedAxes = worldInput.getAxes();
	assert.equal(keyboardIntents.length, beforeVisibilityRepeat, 'held keyboard repeat after visibility restore must not emit a melee edge');
	assert.equal(repeatedAxes.forward, 0, 'held W repeat after visibility restore must not resume movement without a fresh press');
	assert.equal(repeatedAxes.jumpRequested, false, 'held Space repeat after visibility restore must not emit a jump edge');
	assert.equal(repeatedAxes.lockOnRequested, false, 'held Tab repeat after visibility restore must not emit a lock-on edge');
	for (const code of ['KeyW', 'KeyC', 'Space', 'Tab']) dispatchKey(worldTarget, 'keyup', code);
	dispatchKey(worldTarget, 'keydown', 'KeyC');
	assert.deepEqual(keyboardIntents.at(-1), { kind: 'light', source: 'keyboard' }, 'fresh keyboard press after visibility restore must remain responsive');
	dispatchKey(worldTarget, 'keyup', 'KeyC');

	const beforePause = keyboardIntents.length;
	dispatchKey(pausedTarget, 'keydown', 'KeyW');
	dispatchKey(pausedTarget, 'keydown', 'KeyC');
	dispatchKey(pausedTarget, 'keydown', 'KeyR');
	dispatchPointer(pausedTarget, 'pointerdown', 0);
	const pausedAxes = pausedInput.getAxes();
	assert.equal(keyboardIntents.length, beforePause, 'pause must suppress keyboard and pointer melee intents');
	assert.deepEqual({ forward: pausedAxes.forward, strafe: pausedAxes.strafe, running: pausedAxes.running, jumpRequested: pausedAxes.jumpRequested, lockOnRequested: pausedAxes.lockOnRequested, guarding: pausedAxes.guarding, lookX: pausedAxes.lookX, lookY: pausedAxes.lookY, cameraZoom: pausedAxes.cameraZoom }, { forward: 0, strafe: 0, running: false, jumpRequested: false, lockOnRequested: false, guarding: false, lookX: 0, lookY: 0, cameraZoom: 0 }, 'pause must neutralize queued gameplay axes and action edges');
	pauseBlocked = false;
	dispatchKey(pausedTarget, 'keydown', 'KeyC');
	assert.deepEqual(keyboardIntents.at(-1), { kind: 'light', source: 'keyboard' }, 'fresh input after resume must remain responsive');

	const touchContainer = lifecycleDocument.body;
	let touchBlocked = true;
	touchInput = new TouchJoystick(touchContainer, { isInputBlocked: () => touchBlocked });
	const beforeTouchPause = keyboardIntents.length;
	dispatchPointer(touchInput._lightAttackButton, 'pointerdown', 0);
	dispatchPointer(touchInput._heavyAttackButton, 'pointerdown', 0);
	touchInput._jumpButton.dispatchEvent(new Event('click', { cancelable: true }));
	dispatchPointer(touchInput._guardButton, 'pointerdown', 0);
	dispatchPointer(touchInput._lockOnButton, 'pointerdown', 0);
	assert.equal(keyboardIntents.length, beforeTouchPause, 'pause must suppress touch melee intents');
	assert.deepEqual(touchInput.getAxes(), { forward: 0, strafe: 0, running: false, guarding: false }, 'pause must neutralize touch movement and guard state');
	assert.equal(touchInput.consumeJumpRequested(), false, 'pause must clear queued touch jump');
	assert.equal(touchInput.consumeLockOnRequested(), false, 'pause must clear queued touch lock-on');

	touchBlocked = false;
	dispatchPointer(touchInput._lightAttackButton, 'pointerdown', 0);
	assert.deepEqual(keyboardIntents.at(-1), { kind: 'light', source: 'touch' }, 'fresh touch light attack after resume must remain responsive');
	touchInput._jumpButton.dispatchEvent(new Event('click', { cancelable: true }));
	assert.equal(touchInput.consumeJumpRequested(), true, 'fresh touch jump after resume must remain responsive');
	dispatchPointer(touchInput._guardButton, 'pointerdown', 0);
	assert.equal(touchInput.getAxes().guarding, true, 'fresh touch guard after resume must remain responsive');
	dispatchPointer(touchInput._guardButton, 'pointerup', 0);
	dispatchPointer(touchInput._lockOnButton, 'pointerdown', 0);
	assert.equal(touchInput.consumeLockOnRequested(), true, 'fresh touch lock-on after resume must remain responsive');

	// Mobile/PWA backgrounding can happen while a finger is still captured by the joystick. The
	// document visibility event must release that capture and clear all held/queued touch actions.
	dispatchPointer(touchInput._base, 'pointerdown', 0, 44, 10, 10);
	dispatchPointer(touchInput._base, 'pointermove', 0, 44, 60, 10);
	touchInput._jumpButton.dispatchEvent(new Event('click', { cancelable: true }));
	dispatchPointer(touchInput._guardButton, 'pointerdown', 0);
	dispatchPointer(touchInput._lockOnButton, 'pointerdown', 0);
	assert.equal(touchInput._pointerId, 44, 'touch lifecycle fixture must start with an active captured joystick pointer');
	assert.equal(touchInput.getAxes().guarding, true, 'touch lifecycle fixture must start with guard held');
	lifecycleDocument.hidden = true;
	lifecycleDocument.dispatchEvent(new Event('visibilitychange'));
	assert.equal(touchInput._pointerId, null, 'visibility loss must release the active touch joystick pointer');
	assert.equal(touchInput._base.capturedPointerId, null, 'visibility loss must release pointer capture');
	assert.deepEqual(touchInput.getAxes(), { forward: 0, strafe: 0, running: false, guarding: false }, 'visibility loss must neutralize touch movement and guard');
	assert.equal(touchInput.consumeJumpRequested(), false, 'visibility loss must clear queued touch jump');
	assert.equal(touchInput.consumeLockOnRequested(), false, 'visibility loss must clear queued touch lock-on');
	assert.equal(touchInput._guardButton.getAttribute('aria-pressed'), 'false', 'visibility loss must clear the visible held-guard state');
	lifecycleDocument.hidden = false;
	const beforeTouchLifecycleResume = keyboardIntents.length;
	dispatchPointer(touchInput._lightAttackButton, 'pointerdown', 0);
	assert.equal(keyboardIntents.length, beforeTouchLifecycleResume + 1, 'fresh touch attack after PWA visibility restore must remain responsive');
	assert.deepEqual(keyboardIntents.at(-1), { kind: 'light', source: 'touch' }, 'restored touch attack must use the canonical combat intent');

	// Some mobile Safari/PWA transitions deliver pagehide even when visibilitychange is skipped or
	// delayed. The window lifecycle path must reuse the exact same reset without waiting for a frame.
	dispatchPointer(touchInput._base, 'pointerdown', 0, 91, 15, 15);
	dispatchPointer(touchInput._base, 'pointermove', 0, 91, 55, 15);
	touchInput._jumpButton.dispatchEvent(new Event('click', { cancelable: true }));
	dispatchPointer(touchInput._guardButton, 'pointerdown', 0);
	dispatchPointer(touchInput._lockOnButton, 'pointerdown', 0);
	assert.equal(touchInput._pointerId, 91, 'pagehide fixture must start with captured touch input');
	lifecycleWindow.dispatchEvent(new Event('pagehide'));
	assert.equal(touchInput._pointerId, null, 'pagehide must release the active touch pointer');
	assert.equal(touchInput._base.capturedPointerId, null, 'pagehide must release touch pointer capture');
	assert.deepEqual(touchInput.getAxes(), { forward: 0, strafe: 0, running: false, guarding: false }, 'pagehide must neutralize touch movement and guard');
	assert.equal(touchInput.consumeJumpRequested(), false, 'pagehide must clear queued touch jump');
	assert.equal(touchInput.consumeLockOnRequested(), false, 'pagehide must clear queued touch lock-on');
	assert.equal(touchInput._guardButton.getAttribute('aria-pressed'), 'false', 'pagehide must clear the visible guard-held state');
} finally {
	touchInput?.dispose();
	worldInput.dispose(); interactiveInput.dispose(); pausedInput.dispose();
	globalThis.dispatchEvent = previousDispatchEvent;
	globalThis.document = previousDocument;
	if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
	if (previousCustomEvent) globalThis.CustomEvent = previousCustomEvent; else delete globalThis.CustomEvent;
}

console.log(JSON.stringify({ ok: true, contract: 'player-melee-combo-input-window', attack: cfg, windupSteering: { turnMultiplier: 0.68, preActiveOnly: true, activeHoming: false }, inputs: { keyboard: ['KeyC', 'KeyR'], interactionReserved: 'KeyE', mouse: 'button0-light', gamepad: ['A/button0-jump', 'X/button2-light', 'Y/button3-heavy'], touch: ['light', 'heavy', 'jump', 'guard', 'lock-on'], interactiveDomCombatSuppressed: true, pauseGameplayInputSuppressed: true, touchPauseGameplayInputSuppressed: true, lifecycleIsolation: ['document-visibility', 'window-pagehide', 'held-key-repeat', 'held-movement-repeat', 'touch-pointer-reset'] }, assetPolicy: { newModel: false, fabricatedAttackClip: false, canonicalAnimationConfig: 'src/3d/gameplay/playerConfig.js', sharedMaterialCoreUnchanged: true }, ownership: { npcDamageConsumerModified: false, terrainModified: false, rpgSemanticsModified: false } }, null, 2));
