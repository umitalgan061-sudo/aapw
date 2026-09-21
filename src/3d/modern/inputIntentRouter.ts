import type { FrameId } from './types';
import type { Axis2D, InputActionEvent, RuntimeAction, RuntimeInputSource } from './runtimeContracts';
import { normalizeAxis, normalizeAxis2D } from './runtimeContracts';

export type IntentChannel = 'movement' | 'camera' | 'interaction' | 'ui' | 'debug';
export type InputMode = 'gameplay' | 'menu' | 'dialogue' | 'editor' | 'spectator';

export interface IntentBinding {
  readonly action: RuntimeAction;
  readonly channel: IntentChannel;
  readonly priority: number;
  readonly consume: boolean;
  readonly allowedModes?: readonly InputMode[];
}

export interface IntentDecision {
  readonly frame: FrameId;
  readonly action: RuntimeAction;
  readonly channel: IntentChannel;
  readonly source: RuntimeInputSource;
  readonly consumed: boolean;
  readonly value: number;
}

export interface InputIntentState {
  readonly mode: InputMode;
  readonly movement: Axis2D;
  readonly camera: Axis2D;
  readonly pressed: readonly RuntimeAction[];
  readonly released: readonly RuntimeAction[];
  readonly decisions: readonly IntentDecision[];
}

const DEFAULT_BINDINGS: readonly IntentBinding[] = Object.freeze([
  { action: 'move.forward', channel: 'movement', priority: 10, consume: false },
  { action: 'move.backward', channel: 'movement', priority: 10, consume: false },
  { action: 'move.left', channel: 'movement', priority: 10, consume: false },
  { action: 'move.right', channel: 'movement', priority: 10, consume: false },
  { action: 'move.sprint', channel: 'movement', priority: 20, consume: true },
  { action: 'move.jump', channel: 'movement', priority: 30, consume: true },
  { action: 'camera.orbit.left', channel: 'camera', priority: 10, consume: false },
  { action: 'camera.orbit.right', channel: 'camera', priority: 10, consume: false },
  { action: 'camera.zoom.in', channel: 'camera', priority: 10, consume: true },
  { action: 'camera.zoom.out', channel: 'camera', priority: 10, consume: true },
  { action: 'interaction.primary', channel: 'interaction', priority: 40, consume: true, allowedModes: ['gameplay', 'dialogue'] },
  { action: 'interaction.secondary', channel: 'interaction', priority: 20, consume: true, allowedModes: ['gameplay', 'dialogue'] },
  { action: 'ui.pause', channel: 'ui', priority: 100, consume: true, allowedModes: ['gameplay', 'menu', 'dialogue', 'editor', 'spectator'] },
  { action: 'ui.inventory', channel: 'ui', priority: 90, consume: true, allowedModes: ['gameplay'] },
  { action: 'ui.map', channel: 'ui', priority: 90, consume: true, allowedModes: ['gameplay'] },
  { action: 'ui.settings', channel: 'ui', priority: 95, consume: true, allowedModes: ['gameplay', 'menu'] },
  { action: 'debug.toggle', channel: 'debug', priority: 200, consume: true, allowedModes: ['gameplay', 'editor', 'spectator'] },
]);

function axisFromAction(action: RuntimeAction, value: number): Axis2D {
  const v = normalizeAxis(value);
  if (action === 'move.forward') return { x: 0, y: v };
  if (action === 'move.backward') return { x: 0, y: -v };
  if (action === 'move.left') return { x: -v, y: 0 };
  if (action === 'move.right') return { x: v, y: 0 };
  if (action === 'camera.orbit.left') return { x: -v, y: 0 };
  if (action === 'camera.orbit.right') return { x: v, y: 0 };
  return { x: 0, y: 0 };
}

/** Resolves simultaneous input sources into deterministic game intents without knowing UI details. */
export class InputIntentRouter {
  #bindings = new Map<RuntimeAction, IntentBinding>();
  #mode: InputMode = 'gameplay';
  #frame = 0 as FrameId;
  #movement = { x: 0, y: 0 };
  #camera = { x: 0, y: 0 };
  #pressed = new Set<RuntimeAction>();
  #released = new Set<RuntimeAction>();
  #decisions: IntentDecision[] = [];

  constructor(bindings: readonly IntentBinding[] = DEFAULT_BINDINGS) {
    for (const binding of bindings) this.#bindings.set(binding.action, Object.freeze({ ...binding, priority: Math.max(0, Math.trunc(binding.priority)) }));
  }

  setMode(mode: InputMode): void {
    this.#mode = mode;
    if (mode !== 'gameplay') this.#movement = { x: 0, y: 0 };
  }

  get mode(): InputMode { return this.#mode; }

  beginFrame(frame: FrameId): void {
    this.#frame = frame;
    this.#pressed.clear();
    this.#released.clear();
    this.#decisions.length = 0;
  }

  consume(event: InputActionEvent): IntentDecision | null {
    const binding = this.#bindings.get(event.action);
    if (!binding) return null;
    if (binding.allowedModes && !binding.allowedModes.includes(this.#mode)) return null;
    if (event.phase === 'pressed') this.#pressed.add(event.action);
    if (event.phase === 'released') this.#released.add(event.action);
    if (event.action.startsWith('move.')) this.#applyMovement(event);
    if (event.action.startsWith('camera.')) this.#applyCamera(event);
    const decision: IntentDecision = Object.freeze({ frame: this.#frame, action: event.action, channel: binding.channel, source: event.source, consumed: binding.consume, value: normalizeAxis(event.value) });
    this.#decisions.push(decision);
    this.#decisions.sort((a, b) => (this.#bindings.get(b.action)?.priority ?? 0) - (this.#bindings.get(a.action)?.priority ?? 0) || a.action.localeCompare(b.action));
    return decision;
  }

  snapshot(): InputIntentState {
    return Object.freeze({
      mode: this.#mode,
      movement: Object.freeze(normalizeAxis2D(this.#movement)),
      camera: Object.freeze(normalizeAxis2D(this.#camera)),
      pressed: Object.freeze([...this.#pressed]),
      released: Object.freeze([...this.#released]),
      decisions: Object.freeze([...this.#decisions]),
    });
  }

  bind(binding: IntentBinding): void { this.#bindings.set(binding.action, Object.freeze({ ...binding })); }
  unbind(action: RuntimeAction): boolean { return this.#bindings.delete(action); }
  bindings(): readonly IntentBinding[] { return Object.freeze([...this.#bindings.values()].sort((a, b) => b.priority - a.priority)); }

  #applyMovement(event: InputActionEvent): void {
    if (this.#mode !== 'gameplay' && this.#mode !== 'spectator') return;
    const axis = axisFromAction(event.action, event.value);
    const weight = event.source === 'replay' ? 1 : event.source === 'gamepad' || event.source === 'touch' ? 1 : 1;
    if (event.phase === 'released' || event.phase === 'pressed') return;
    this.#movement = { x: this.#movement.x + axis.x * weight, y: this.#movement.y + axis.y * weight };
  }

  #applyCamera(event: InputActionEvent): void {
    const axis = axisFromAction(event.action, event.value);
    if (event.phase === 'released' || event.phase === 'pressed') return;
    this.#camera = { x: this.#camera.x + axis.x, y: this.#camera.y + axis.y };
  }
}

export function actionPriority(action: RuntimeAction, bindings: readonly IntentBinding[] = DEFAULT_BINDINGS): number {
  return bindings.find((binding) => binding.action === action)?.priority ?? -1;
}
