/**
 * Device-agnostic input intent layer for AAPW v3.
 *
 * Browser events are converted into semantic intents before gameplay consumes them. This prevents
 * keyboard, touch, gamepad and replay inputs from becoming separate gameplay implementations and
 * makes the authoritative command stream portable across platforms.
 */

export type InputDeviceV3 = 'keyboard' | 'mouse' | 'touch' | 'gamepad' | 'replay' | 'virtual';
export type InputActionV3 = 'moveX' | 'moveY' | 'lookX' | 'lookY' | 'jump' | 'dodge' | 'attack' | 'block' | 'interact' | 'sprint' | 'pause';

export interface RawInputStateV3 {
  readonly device: InputDeviceV3;
  readonly timestampTick: number;
  readonly axes: Readonly<Record<string, number>>;
  readonly buttons: Readonly<Record<string, boolean>>;
}

export interface InputIntentV3 {
  readonly action: InputActionV3;
  readonly value: number;
  readonly pressed: boolean;
  readonly repeated: boolean;
  readonly source: InputDeviceV3;
  readonly tick: number;
}

export interface InputMapV3 {
  readonly action: InputActionV3;
  readonly axes?: readonly string[];
  readonly buttons?: readonly string[];
  readonly deadZone?: number;
  readonly scale?: number;
  readonly invert?: boolean;
}

export interface InputFrameV3 {
  readonly tick: number;
  readonly intents: readonly InputIntentV3[];
}

const actions: readonly InputActionV3[] = ['moveX', 'moveY', 'lookX', 'lookY', 'jump', 'dodge', 'attack', 'block', 'interact', 'sprint', 'pause'];
const actionSet = new Set(actions);
const clamp = (value: number, min = -1, max = 1): number => Math.min(max, Math.max(min, value));

const axisValue = (state: RawInputStateV3, keys: readonly string[]): number => {
  let total = 0;
  for (const key of keys) total += state.axes[key] ?? 0;
  return clamp(total);
};

const buttonValue = (state: RawInputStateV3, keys: readonly string[]): boolean => keys.some((key) => state.buttons[key] === true);

export class InputIntentMapperV3 {
  #maps: InputMapV3[];
  #previousButtons = new Map<InputActionV3, boolean>();

  constructor(maps: readonly InputMapV3[]) {
    this.#maps = maps.filter((map) => {
      if (!actionSet.has(map.action)) return false;
      if (map.deadZone !== undefined && (!Number.isFinite(map.deadZone) || map.deadZone < 0 || map.deadZone >= 1)) return false;
      return true;
    }).map((map) => ({ ...map }));
  }

  map(state: RawInputStateV3): InputFrameV3 {
    if (!Number.isInteger(state.timestampTick) || state.timestampTick < 0) throw new RangeError('Invalid input tick');
    const intents: InputIntentV3[] = [];
    const seen = new Set<InputActionV3>();
    for (const mapping of this.#maps) {
      if (seen.has(mapping.action)) continue;
      seen.add(mapping.action);
      const axes = mapping.axes?.length ? axisValue(state, mapping.axes) : 0;
      const button = mapping.buttons?.length ? buttonValue(state, mapping.buttons) : false;
      let value = axes !== 0 ? axes : button ? 1 : 0;
      const deadZone = mapping.deadZone ?? 0.08;
      if (Math.abs(value) < deadZone) value = 0;
      else if (Math.abs(value) > 0) value = Math.sign(value) * ((Math.abs(value) - deadZone) / (1 - deadZone));
      value = clamp(value * (mapping.scale ?? 1));
      if (mapping.invert) value *= -1;
      const previous = this.#previousButtons.get(mapping.action) ?? false;
      const pressed = value !== 0 || button;
      intents.push(Object.freeze({
        action: mapping.action,
        value,
        pressed,
        repeated: pressed && previous,
        source: state.device,
        tick: state.timestampTick,
      }));
      this.#previousButtons.set(mapping.action, pressed);
    }
    intents.sort((a, b) => a.action.localeCompare(b.action));
    return Object.freeze({ tick: state.timestampTick, intents: Object.freeze(intents) });
  }

  reset(): void { this.#previousButtons.clear(); }
}

export const DEFAULT_INPUT_MAP_V3: readonly InputMapV3[] = [
  { action: 'moveX', axes: ['moveX', 'horizontal'], deadZone: 0.08 },
  { action: 'moveY', axes: ['moveY', 'vertical'], deadZone: 0.08 },
  { action: 'lookX', axes: ['lookX', 'mouseX'], deadZone: 0.04 },
  { action: 'lookY', axes: ['lookY', 'mouseY'], deadZone: 0.04, invert: true },
  { action: 'jump', buttons: ['jump', 'Space'] },
  { action: 'dodge', buttons: ['dodge', 'ShiftLeft'] },
  { action: 'attack', buttons: ['attack', 'MouseLeft'] },
  { action: 'block', buttons: ['block', 'MouseRight'] },
  { action: 'interact', buttons: ['interact', 'KeyE'] },
  { action: 'sprint', buttons: ['sprint', 'ShiftRight'] },
  { action: 'pause', buttons: ['pause', 'Escape'] },
];

export const createDefaultInputMapperV3 = (): InputIntentMapperV3 => new InputIntentMapperV3(DEFAULT_INPUT_MAP_V3);
