#!/usr/bin/env node
import assert from 'node:assert/strict';
import { KeyboardInput } from '../src/3d/input.js';

const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const calls = [];
const makePad = ({ index = 7, mapping = 'standard', connected = true } = {}) => ({
	index,
	mapping,
	connected,
	axes: [0, 0, 0, 0],
	buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
	vibrationActuator: {
		playEffect(type, options) {
			calls.push({ type, options });
			return Promise.resolve();
		},
	},
});

const pad = makePad();
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });
const target = new EventTarget();
const input = new KeyboardInput(target);
const emitFeedback = (detail) => {
	const event = new Event('aapw:player-combat-feedback');
	Object.defineProperty(event, 'detail', { value: detail });
	target.dispatchEvent(event);
};

try {
	// Authoritative combat feedback must never activate/switch a controller by itself.
	emitFeedback({ serial: 501, outcome: 'hit-stagger', appliedAmount: 20, blockedAmount: 0 });
	assert.equal(calls.length, 0, 'feedback before input polling must not activate a Standard controller');

	// Once normal input polling selects the sticky Standard controller, the same unconsumed serial is valid.
	input.getAxes();
	emitFeedback({ serial: 501, outcome: 'hit-stagger', appliedAmount: 20, blockedAmount: 0 });
	assert.equal(calls.length, 1, 'pre-activation feedback serial must remain available after normal controller selection');
	assert.equal(calls[0].type, 'dual-rumble');

	// Successful delivery consumes the serial exactly once.
	emitFeedback({ serial: 501, outcome: 'hit-stagger', appliedAmount: 20, blockedAmount: 0 });
	assert.equal(calls.length, 1, 'successfully delivered serial must dedupe');

	// A malformed/no-op receipt must not consume its serial; corrected authoritative evidence may reuse it.
	emitFeedback({ serial: 502, outcome: 'guard', appliedAmount: 0, blockedAmount: 0 });
	assert.equal(calls.length, 1, 'zero-evidence guard receipt must not rumble');
	emitFeedback({ serial: 502, outcome: 'guard', appliedAmount: 0, blockedAmount: 12 });
	assert.equal(calls.length, 2, 'rejected no-op receipt must not consume the authoritative serial');

	// Non-Standard pads remain unable to receive combat-result haptics even if previously selected state exists.
	pad.mapping = '';
	emitFeedback({ serial: 503, outcome: 'hit', appliedAmount: 9, blockedAmount: 0 });
	assert.equal(calls.length, 2, 'non-Standard controller must not receive result haptics');
} finally {
	input.dispose();
	if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
	else delete globalThis.navigator;
}

console.log('[checkPlayerCombatFeedbackHapticActivation] PASS');
