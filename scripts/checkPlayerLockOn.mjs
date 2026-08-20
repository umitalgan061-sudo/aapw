#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PLAYER_LOCK_ON_CONFIG, applyPlayerLockFacing, computePlayerLockViewForward, createPlayerLockOnController, evaluatePlayerLockTarget, selectPlayerLockTarget } from '../src/3d/gameLoopHelpers.js';

const entity = (id, x, z, y = 0) => ({ id, displayName: id, object3D: { position: { x, y, z }, rotation: { y: 0 }, userData: {} } });
const player = { x: 0, y: 0, z: 0 }, forward = { x: 0, z: 1 };
assert.equal(PLAYER_LOCK_ON_CONFIG.ACQUIRE_DISTANCE_METERS, 30); assert.equal(PLAYER_LOCK_ON_CONFIG.BREAK_DISTANCE_METERS, 38);
assert.ok(PLAYER_LOCK_ON_CONFIG.ACQUIRE_HALF_ANGLE_DEGREES > 45 && PLAYER_LOCK_ON_CONFIG.ACQUIRE_HALF_ANGLE_DEGREES < 90);
assert.ok(PLAYER_LOCK_ON_CONFIG.TRACK_HALF_ANGLE_DEGREES > PLAYER_LOCK_ON_CONFIG.ACQUIRE_HALF_ANGLE_DEGREES && PLAYER_LOCK_ON_CONFIG.TRACK_HALF_ANGLE_DEGREES < 180);
const center = evaluatePlayerLockTarget({ playerPosition: player, forward, entity: entity('center', 0, 10) }); assert.equal(center.eligible, true); assert.ok(center.angleDegrees < 0.001); assert.equal(Number(center.distanceMeters.toFixed(3)), 10);
const behind = evaluatePlayerLockTarget({ playerPosition: player, forward, entity: entity('behind', 0, -8) }); assert.equal(behind.eligible, false); assert.equal(behind.reason, 'angle');
const far = evaluatePlayerLockTarget({ playerPosition: player, forward, entity: entity('far', 0, 31) }); assert.equal(far.eligible, false); assert.equal(far.reason, 'range');
const hidden = entity('hidden-center', 0, 6); hidden.object3D.visible = false; const hiddenEval = evaluatePlayerLockTarget({ playerPosition: player, forward, entity: hidden }); assert.equal(hiddenEval.eligible, false); assert.equal(hiddenEval.reason, 'unavailable');
const disabled = entity('disabled-center', 0, 5); disabled.object3D.userData.lockOnDisabled = true; const disabledEval = evaluatePlayerLockTarget({ playerPosition: player, forward, entity: disabled }); assert.equal(disabledEval.eligible, false); assert.equal(disabledEval.reason, 'unavailable');
const candidates = [hidden, disabled, entity('near-edge', 8, 8), entity('center-farther', 0, 12), entity('behind', 0, -4)]; assert.equal(selectPlayerLockTarget({ playerPosition: player, forward, candidates }).id, 'center-farther');
const tieA = entity('alpha', -2, 10), tieB = entity('beta', 2, 10); assert.equal(selectPlayerLockTarget({ playerPosition: player, forward, candidates: [tieB, tieA] }).id, 'alpha'); assert.equal(selectPlayerLockTarget({ playerPosition: player, forward, candidates: [tieA, tieB] }).id, 'alpha');
const view = computePlayerLockViewForward({ x: 0, z: 8 }, { x: 0, z: 0 }); assert.ok(Math.abs(view.x) < 1e-9 && view.z < -0.999);
const facingPlayer = { position: { x: 0, z: 0 }, rotation: { y: 0 } }; assert.equal(applyPlayerLockFacing(facingPlayer, { x: 10, z: 0 }, 0.05), true); assert.ok(facingPlayer.rotation.y > 0 && facingPlayer.rotation.y <= 0.55 + 1e-9); for (let i = 0; i < 20; i += 1) applyPlayerLockFacing(facingPlayer, { x: 10, z: 0 }, 0.05); assert.ok(Math.abs(facingPlayer.rotation.y - Math.PI / 2) < 0.01);

const previousCustomEvent = globalThis.CustomEvent, previousDispatch = globalThis.dispatchEvent;
if (typeof globalThis.CustomEvent !== 'function') globalThis.CustomEvent = class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };
const events = []; globalThis.dispatchEvent = (event) => { events.push({ type: event.type, detail: event.detail }); return true; };
try {
	const controller = createPlayerLockOnController(), target = entity('guard-a', 0, 10), other = entity('guard-b', 5, 10);
	let snapshot = controller.update({ playerPosition: player, forward, candidates: [other, target], toggleRequested: true }); assert.equal(snapshot.locked, true); assert.equal(snapshot.targetId, 'guard-a'); assert.equal(events.at(-1)?.detail.reason, 'acquired'); assert.deepEqual(events.at(-1)?.detail.targetPosition, { x: 0, y: 0, z: 10 });
	target.object3D.position.x = 3; snapshot = controller.update({ playerPosition: player, forward, candidates: [other, target] }); assert.equal(snapshot.locked, true); assert.equal(snapshot.targetPosition.x, 3);
	snapshot = controller.update({ playerPosition: player, forward, candidates: [other, target], toggleRequested: true }); assert.equal(snapshot.locked, false); assert.equal(events.at(-1)?.detail.reason, 'toggle-release');
	snapshot = controller.update({ playerPosition: player, forward, candidates: [target], toggleRequested: true }); assert.equal(snapshot.locked, true); target.object3D.position.z = PLAYER_LOCK_ON_CONFIG.BREAK_DISTANCE_METERS + 1; snapshot = controller.update({ playerPosition: player, forward, candidates: [target] }); assert.equal(snapshot.locked, false); assert.equal(events.at(-1)?.detail.reason, 'range-break');
	target.object3D.position.z = 10; controller.update({ playerPosition: player, forward, candidates: [target], toggleRequested: true }); snapshot = controller.update({ playerPosition: player, forward, candidates: [] }); assert.equal(snapshot.locked, false); assert.equal(events.at(-1)?.detail.reason, 'target-removed');
	controller.update({ playerPosition: player, forward, candidates: [target], toggleRequested: true }); target.object3D.visible = false; snapshot = controller.update({ playerPosition: player, forward, candidates: [target] }); assert.equal(snapshot.locked, false); assert.equal(events.at(-1)?.detail.reason, 'target-unavailable'); target.object3D.visible = true;
	controller.update({ playerPosition: player, forward, candidates: [target], toggleRequested: true }); target.object3D.userData.lockOnDisabled = true; snapshot = controller.update({ playerPosition: player, forward, candidates: [target] }); assert.equal(snapshot.locked, false); assert.equal(events.at(-1)?.detail.reason, 'target-unavailable'); delete target.object3D.userData.lockOnDisabled;
	controller.update({ playerPosition: player, forward, candidates: [target], toggleRequested: true }); snapshot = controller.update({ playerPosition: player, forward: { x: 0, z: -1 }, candidates: [target] }); assert.equal(snapshot.locked, false); assert.equal(events.at(-1)?.detail.reason, 'view-break');
} finally { globalThis.dispatchEvent = previousDispatch; if (previousCustomEvent) globalThis.CustomEvent = previousCustomEvent; else delete globalThis.CustomEvent; }

const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator'); let pads = []; Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => pads } });
const { KeyboardInput } = await import('../src/3d/input.js'); const makePad = ({ index = 0, mapping = 'standard', buttons = {}, connected = true } = {}) => ({ index, mapping, connected, axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: Boolean(buttons[i]), value: buttons[i] ? 1 : 0 })) });
const inputTarget = new EventTarget(), input = new KeyboardInput(inputTarget);
try {
	pads = [makePad({ index: 2, buttons: { 11: true } })]; input.getAxes(); assert.equal(input.consumeLockOnRequested(), false);
	pads = [makePad({ index: 2 })]; input.getAxes(); pads = [makePad({ index: 2, buttons: { 11: true } })]; input.getAxes(); assert.equal(input.consumeLockOnRequested(), true); input.getAxes(); assert.equal(input.consumeLockOnRequested(), false);
	pads = [makePad({ index: 2, mapping: '', buttons: { 11: true } })]; input.getAxes(); assert.equal(input.consumeLockOnRequested(), false);
	pads = []; const tabDown = new Event('keydown', { cancelable: true }); Object.defineProperty(tabDown, 'code', { value: 'Tab' }); inputTarget.dispatchEvent(tabDown); assert.equal(tabDown.defaultPrevented, true); assert.equal(input.consumeLockOnRequested(), true); inputTarget.dispatchEvent(tabDown); assert.equal(input.consumeLockOnRequested(), false);
	const tabUp = new Event('keyup'); Object.defineProperty(tabUp, 'code', { value: 'Tab' }); inputTarget.dispatchEvent(tabUp); const tabAgain = new Event('keydown', { cancelable: true }); Object.defineProperty(tabAgain, 'code', { value: 'Tab' }); inputTarget.dispatchEvent(tabAgain); assert.equal(input.consumeLockOnRequested(), true);
} finally { input.dispose(); if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else delete globalThis.navigator; }

const inputSource = fs.readFileSync(new URL('../src/3d/input.js', import.meta.url), 'utf8');
for (const fragment of ["const LOCK_ON_KEYS = new Set(['Tab'])", 'LOCK_ON: 11', 'lockOnPressed: buttons.lockOn && !previousButtons.lockOn', 'if (sample.lockOnPressed) this._lockOnRequested = true', 'consumeLockOnRequested()']) assert.ok(inputSource.includes(fragment), `missing lock-on input contract: ${fragment}`);
const touchSource = fs.readFileSync(new URL('../src/3d/ui/touchJoystick.js', import.meta.url), 'utf8');
for (const fragment of ["className = 'g3d-touch-lock-on-button'", "setAttribute('aria-label', 'Hedef kilidi')", "setAttribute('aria-pressed', 'false')", 'this._lockOnRequested = true', 'consumeLockOnRequested()', 'setLockOnActive(active)', "classList.toggle('g3d-touch-lock-on-active', locked)", "textContent = locked ? 'Kilitli' : 'Hedef'"]) assert.ok(touchSource.includes(fragment), `missing touch lock-on parity: ${fragment}`);
const loopSource = fs.readFileSync(new URL('../src/3d/gameLoopHelpers.js', import.meta.url), 'utf8');
for (const fragment of ['export const PLAYER_LOCK_ON_CONFIG', 'TRACK_HALF_ANGLE_DEGREES: 125', 'const entityLockAvailable = (entity)', "clear('target-unavailable')", "clear('view-break')", 'export function createPlayerLockOnController', 'export function updatePlayerLockOn(state)', 'candidates: state.npcs ?? []', 'state.keyboardInput.consumeLockOnRequested?.()', 'state.touchJoystick?.consumeLockOnRequested?.()', 'toggleRequested: !state.paused && (keyboardToggle || touchToggle)', 'state.touchJoystick?.setLockOnActive?.(Boolean(snapshot?.locked))', 'applyPlayerLockFacing(state.player.object3D', 'updatePlayerLockOn(state);']) assert.ok(loopSource.includes(fragment), `missing shipped lock-on integration: ${fragment}`);
assert.ok(!loopSource.includes('npc.update('), 'Player lock-on adapter must not mutate or invoke NPC AI');
assert.ok(!fs.existsSync(new URL('../src/3d/gameplay/playerLockOn.js', import.meta.url)), 'lock-on must not add an uncached parallel runtime module');
console.log('[checkPlayerLockOn] PASS');
