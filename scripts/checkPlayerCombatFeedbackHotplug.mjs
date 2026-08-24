import assert from 'node:assert/strict';
import { KeyboardInput } from '../src/3d/input.js';

class FakeInputTarget {
  constructor() { this.hidden = false; this.listeners = new Map(); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) handler({ type, ...event });
  }
}

const calls = [];
const fallbackCalls = [];
let connected = true;
const primaryActuator = {
  playEffect(type, options) {
    calls.push({ type, options });
    return Promise.resolve();
  },
};
const fallbackActuator = {
  playEffect(type, options) {
    fallbackCalls.push({ type, options });
    return Promise.resolve();
  },
};
const pad = {
  index: 6,
  mapping: 'standard',
  get connected() { return connected; },
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
  vibrationActuator: primaryActuator,
  hapticActuators: [fallbackActuator],
};

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { getGamepads: () => [pad] },
});

try {
  const target = new FakeInputTarget();
  const input = new KeyboardInput(target);
  input._activeGamepadIndex = 6;

  target.dispatch('aapw:player-combat-feedback', {
    detail: { serial: 21, outcome: 'parry', blockedAmount: 12 },
  });
  assert.equal(calls.length, 1, 'active controller must receive authoritative feedback');
  assert.equal(fallbackCalls.length, 0, 'primary vibration actuator must take precedence when available');

  connected = false;
  target.dispatch('aapw:player-combat-feedback', {
    detail: { serial: 22, outcome: 'hit', appliedAmount: 10 },
  });
  assert.equal(calls.length, 1, 'disconnected controller must not vibrate');

  connected = true;
  target.dispatch('aapw:player-combat-feedback', {
    detail: { serial: 22, outcome: 'hit', appliedAmount: 10 },
  });
  assert.equal(calls.length, 2, 'receipt rejected only for disconnection must remain consumable after reconnect');

  input._activeGamepadIndex = null;
  target.dispatch('aapw:player-combat-feedback', {
    detail: { serial: 23, outcome: 'guard-break', blockedAmount: 8 },
  });
  assert.equal(calls.length, 2, 'inactive controller must not receive feedback');

  input._activeGamepadIndex = 6;
  target.dispatch('aapw:player-combat-feedback', {
    detail: { serial: 23, outcome: 'guard-break', blockedAmount: 8 },
  });
  assert.equal(calls.length, 3, 'inactive-device rejection must not consume the authoritative serial');

  pad.vibrationActuator = null;
  target.dispatch('aapw:player-combat-feedback', {
    detail: { serial: 24, outcome: 'hit-stagger', appliedAmount: 15 },
  });
  assert.equal(calls.length, 3, 'missing primary actuator must not receive the fallback pulse');
  assert.equal(fallbackCalls.length, 1, 'alternate haptic actuator must preserve combat-result feedback');
  assert.equal(fallbackCalls[0].type, 'dual-rumble', 'fallback actuator must keep the canonical dual-rumble effect');
  assert.equal(fallbackCalls[0].options.duration, 128, 'fallback actuator must preserve the hit-stagger profile');

  input.dispose();
} finally {
  if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
  else delete globalThis.navigator;
}

console.log('[checkPlayerCombatFeedbackHotplug] PASS');
