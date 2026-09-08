import assert from 'node:assert/strict';
import { KeyboardInput } from '../src/3d/input.js';

class FakeInputTarget {
  constructor() { this.hidden = false; this.listeners = new Map(); }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  dispatch(type, event = {}) { for (const handler of this.listeners.get(type) ?? []) handler({ type, ...event }); }
}

function makePad(index = 6) {
  return {
    index,
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
  };
}

function setButton(pad, index, pressed) {
  pad.buttons[index].pressed = pressed;
  pad.buttons[index].value = pressed ? 1 : 0;
}

const pad = makePad();
const target = new FakeInputTarget();
let blocked = false;
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });

try {
  const controller = new KeyboardInput(target, { isInputBlocked: () => blocked });
  controller.getAxes(); // select the Standard pad without synthesizing an action edge

  setButton(pad, 4, true);
  assert.equal(controller.getAxes().guarding, true, 'LB must establish sustained gamepad guard');

  setButton(pad, 5, true);
  assert.equal(controller.getAxes().guarding, false, 'RB pressed while LB is held must isolate one guard-off frame');
  assert.equal(controller.getAxes().guarding, true, 'held LB must re-arm guard on the frame after parry isolation');
  assert.equal(controller.getAxes().guarding, true, 'held RB must not retrigger parry without a release edge');

  setButton(pad, 5, false);
  assert.equal(controller.getAxes().guarding, true, 'releasing RB must preserve held LB guard');
  setButton(pad, 4, false);
  assert.equal(controller.getAxes().guarding, false, 'releasing LB must end guard');

  setButton(pad, 4, true);
  controller.getAxes();
  setButton(pad, 5, true);
  assert.equal(controller.getAxes().guarding, false, 'second LB+RB sequence must still open a fresh parry edge');
  target.dispatch('blur');
  assert.equal(controller.getAxes().guarding, true, 'focus recovery must not replay stale parry while physical guard remains held');

  blocked = true;
  assert.equal(controller.getAxes().guarding, false, 'blocked gameplay input must suppress held gamepad defense state');
  blocked = false;
  assert.equal(controller.getAxes().guarding, true, 'unblocking may restore physical guard but must not synthesize a new parry edge');

  setButton(pad, 5, false);
  setButton(pad, 4, false);
  assert.equal(controller.getAxes().guarding, false, 'released controller must return to neutral defense state');
  controller.dispose();
} finally {
  if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
  else delete globalThis.navigator;
}

console.log('PLAYER_GAMEPAD_PARRY_LIFECYCLE_OK');
