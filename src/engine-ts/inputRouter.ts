import type { Disposable } from './types.js';
import { clamp, stableSort } from './deterministic.js';

export type InputDevice = 'keyboard' | 'mouse' | 'pointer' | 'touch' | 'gamepad' | 'virtual' | 'xr';
export type InputPhase = 'pressed' | 'held' | 'released' | 'changed';
export type InputValue = number | boolean | readonly [number, number] | readonly [number, number, number];
export type ActionName = string;

export interface InputActionDefinition {
  readonly name: ActionName;
  readonly type: 'button' | 'axis1d' | 'axis2d' | 'axis3d';
  readonly deadZone?: number;
  readonly curve?: number;
  readonly sensitivity?: number;
  readonly repeatMs?: number;
  readonly priority?: number;
  readonly contexts?: readonly string[];
}

export interface Binding {
  readonly action: ActionName;
  readonly device: InputDevice;
  readonly code: string;
  readonly scale?: number;
  readonly invert?: boolean;
  readonly axis?: number;
  readonly chord?: readonly string[];
  readonly context?: string;
  readonly priority?: number;
}

export interface InputEventRecord {
  readonly sequence: number;
  readonly tick: number;
  readonly timestamp: number;
  readonly device: InputDevice;
  readonly code: string;
  readonly phase: InputPhase;
  readonly value: InputValue;
  readonly action?: ActionName;
  readonly source?: string;
}

export interface ActionState {
  readonly name: ActionName;
  readonly type: InputActionDefinition['type'];
  readonly phase: InputPhase;
  readonly value: InputValue;
  readonly rawValue: InputValue;
  readonly changed: boolean;
  readonly pressed: boolean;
  readonly held: boolean;
  readonly released: boolean;
  readonly lastSequence: number;
  readonly lastChangedAt: number;
}

export interface InputSnapshot {
  readonly tick: number;
  readonly timestamp: number;
  readonly actions: readonly ActionState[];
  readonly devices: readonly InputDevice[];
  readonly sequence: number;
  readonly checksum: string;
}

export interface RecordedInput {
  readonly version: number;
  readonly startedAt: number;
  readonly stoppedAt: number;
  readonly events: readonly InputEventRecord[];
  readonly checksum: string;
}

export interface ReplayCursor {
  readonly finished: boolean;
  readonly position: number;
  readonly remaining: number;
}

export interface InputRouterOptions {
  readonly maxHistory?: number;
  readonly maxActions?: number;
  readonly maxBindings?: number;
  readonly maxContexts?: number;
  readonly clock?: () => number;
}

interface MutableActionState {
  definition: InputActionDefinition;
  phase: InputPhase;
  rawValue: InputValue;
  value: InputValue;
  changed: boolean;
  pressed: boolean;
  held: boolean;
  released: boolean;
  lastSequence: number;
  lastChangedAt: number;
}

const DEFAULTS = Object.freeze({ history: 8192, actions: 512, bindings: 2048, contexts: 32 });

export class InputRouter implements Disposable {
  private readonly actions = new Map<ActionName, MutableActionState>();
  private readonly bindings: Binding[] = [];
  private readonly contextStack: string[] = ['gameplay'];
  private readonly history: InputEventRecord[] = [];
  private readonly maxHistory: number;
  private readonly maxActions: number;
  private readonly maxBindings: number;
  private readonly maxContexts: number;
  private readonly clock: () => number;
  private sequence = 0;
  private tickValue = 0;
  private disposedValue = false;
  private recording: InputRecorder | undefined;

  public constructor(options: InputRouterOptions = {}) {
    this.maxHistory = Math.max(128, Math.trunc(options.maxHistory ?? DEFAULTS.history));
    this.maxActions = Math.max(8, Math.trunc(options.maxActions ?? DEFAULTS.actions));
    this.maxBindings = Math.max(16, Math.trunc(options.maxBindings ?? DEFAULTS.bindings));
    this.maxContexts = Math.max(1, Math.trunc(options.maxContexts ?? DEFAULTS.contexts));
    this.clock = options.clock ?? (() => typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  public get disposed(): boolean { return this.disposedValue; }
  public get currentTick(): number { return this.tickValue; }
  public get activeContext(): string { return this.contextStack[this.contextStack.length - 1] ?? 'gameplay'; }
  public get actionCount(): number { return this.actions.size; }
  public get bindingCount(): number { return this.bindings.length; }

  public defineAction(definition: InputActionDefinition): boolean {
    if (this.disposedValue || this.actions.size >= this.maxActions || !definition.name || this.actions.has(definition.name)) return false;
    const normalized: InputActionDefinition = Object.freeze({ ...definition, deadZone: clamp(definition.deadZone ?? 0.08, 0, 0.95), curve: clamp(definition.curve ?? 1, 0.1, 4), sensitivity: clamp(definition.sensitivity ?? 1, 0, 10), priority: Math.trunc(definition.priority ?? 0) });
    this.actions.set(definition.name, { definition: normalized, phase: 'changed', rawValue: zeroFor(definition.type), value: zeroFor(definition.type), changed: false, pressed: false, held: false, released: false, lastSequence: 0, lastChangedAt: 0 });
    return true;
  }

  public removeAction(name: ActionName): boolean {
    if (this.disposedValue) return false;
    const removed = this.actions.delete(name);
    if (removed) {
      for (let index = this.bindings.length - 1; index >= 0; index -= 1) if (this.bindings[index]?.action === name) this.bindings.splice(index, 1);
    }
    return removed;
  }

  public bind(binding: Binding): boolean {
    if (this.disposedValue || this.bindings.length >= this.maxBindings || !binding.action || !binding.code || !this.actions.has(binding.action)) return false;
    if (this.bindings.some(candidate => bindingEqual(candidate, binding))) return false;
    const next: Binding = Object.freeze({ ...binding, scale: Number.isFinite(binding.scale) ? clamp(Number(binding.scale), -10, 10) : 1, invert: Boolean(binding.invert), priority: Math.trunc(binding.priority ?? 0), ...(binding.chord ? { chord: Object.freeze([...binding.chord]) } : {}) });
    this.bindings.push(next);
    return true;
  }

  public unbind(binding: Binding): boolean {
    if (this.disposedValue) return false;
    const index = this.bindings.findIndex(candidate => bindingEqual(candidate, binding));
    if (index < 0) return false;
    this.bindings.splice(index, 1);
    return true;
  }

  public pushContext(name: string): boolean {
    if (this.disposedValue || !name || this.contextStack.length >= this.maxContexts || this.contextStack.includes(name)) return false;
    this.contextStack.push(name);
    return true;
  }

  public popContext(name?: string): boolean {
    if (this.contextStack.length <= 1) return false;
    if (name && this.activeContext !== name) return false;
    this.contextStack.pop();
    return true;
  }

  public setTick(tick: number): void { if (!this.disposedValue && Number.isFinite(tick)) this.tickValue = Math.max(0, Math.trunc(tick)); }

  public ingest(event: Omit<InputEventRecord, 'sequence' | 'timestamp'> & Partial<Pick<InputEventRecord, 'sequence' | 'timestamp'>>): boolean {
    if (this.disposedValue) return false;
    const timestamp = Number.isFinite(event.timestamp) ? Number(event.timestamp) : this.clock();
    const sequence = Number.isInteger(event.sequence) && Number(event.sequence) > 0 ? Number(event.sequence) : ++this.sequence;
    this.sequence = Math.max(this.sequence, sequence);
    const record: InputEventRecord = Object.freeze({ ...event, sequence, timestamp, tick: Number.isFinite(event.tick) ? Math.max(0, Math.trunc(event.tick)) : this.tickValue });
    this.history.push(record);
    while (this.history.length > this.maxHistory) this.history.shift();
    this.applyBindings(record);
    this.recording?.capture(record);
    return true;
  }

  public beginFrame(tick = this.tickValue): void {
    this.setTick(tick);
    for (const state of this.actions.values()) {
      state.changed = false;
      state.pressed = false;
      state.released = false;
      if (state.phase === 'pressed') state.phase = state.held ? 'held' : 'changed';
      else if (state.phase === 'released') { state.phase = 'changed'; state.held = false; }
    }
  }

  public action(name: ActionName): ActionState | undefined {
    const state = this.actions.get(name);
    return state ? freezeAction(name, state) : undefined;
  }

  public actionsSnapshot(): readonly ActionState[] {
    return Object.freeze(stableSort([...this.actions.entries()].map(([name, state]) => freezeAction(name, state)), (a, b) => a.name.localeCompare(b.name)));
  }

  public consume(name: ActionName): ActionState | undefined {
    const state = this.actions.get(name);
    if (!state || !state.changed) return state ? freezeAction(name, state) : undefined;
    state.changed = false;
    state.pressed = false;
    state.released = false;
    return freezeAction(name, state);
  }

  public snapshot(): InputSnapshot {
    const actions = this.actionsSnapshot();
    const devices = Object.freeze([...new Set(this.history.slice(-64).map(event => event.device))].sort());
    const canonical = JSON.stringify({ tick: this.tickValue, actions, devices, sequence: this.sequence });
    return Object.freeze({ tick: this.tickValue, timestamp: this.clock(), actions, devices, sequence: this.sequence, checksum: fnv1a(canonical) });
  }

  public recent(limit = 128): readonly InputEventRecord[] {
    const count = Math.max(0, Math.trunc(limit));
    return Object.freeze(this.history.slice(Math.max(0, this.history.length - count)).map(event => Object.freeze({ ...event })));
  }

  public historyChecksum(): string { return fnv1a(JSON.stringify(this.history)); }

  public startRecording(clock = this.clock()): InputRecorder {
    if (this.recording) this.recording.stop(clock);
    this.recording = new InputRecorder(clock);
    return this.recording;
  }

  public stopRecording(clock = this.clock()): RecordedInput | undefined {
    if (!this.recording) return undefined;
    const recorder = this.recording;
    this.recording = undefined;
    return recorder.stop(clock);
  }

  public replay(recording: RecordedInput, fromSequence = 0): ReplaySession {
    return new ReplaySession(this, recording, fromSequence);
  }

  public clearHistory(): void { this.history.length = 0; }

  public dispose(): void {
    if (this.disposedValue) return;
    this.actions.clear();
    this.bindings.length = 0;
    this.contextStack.length = 0;
    this.history.length = 0;
    this.recording = undefined;
    this.disposedValue = true;
  }

  private applyBindings(event: InputEventRecord): void {
    const candidates = this.bindings.filter(binding => binding.device === event.device && binding.code === event.code && contextActive(binding.context, this.contextStack) && chordActive(binding.chord, this.history));
    for (const binding of stableSort(candidates, (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.action.localeCompare(b.action))) {
      const state = this.actions.get(binding.action);
      if (!state) continue;
      const value = transformInput(state.definition, event.value, binding);
      applyState(state, value, event, this.sequence);
    }
  }
}

export class InputRecorder {
  private readonly startedAt: number;
  private readonly events: InputEventRecord[] = [];
  private stoppedAt = 0;
  private done = false;
  public constructor(startedAt: number) { this.startedAt = startedAt; }
  public capture(event: InputEventRecord): void { if (!this.done) { this.events.push(Object.freeze({ ...event })); if (this.events.length > 16384) this.events.shift(); } }
  public stop(stoppedAt: number): RecordedInput { this.done = true; this.stoppedAt = stoppedAt; return Object.freeze({ version: 2, startedAt: this.startedAt, stoppedAt, events: Object.freeze([...this.events]), checksum: fnv1a(JSON.stringify(this.events)) }); }
}

export class ReplaySession implements Disposable {
  private readonly router: InputRouter;
  private readonly events: readonly InputEventRecord[];
  private position = 0;
  private disposedValue = false;
  private emitted = 0;
  public constructor(router: InputRouter, recording: RecordedInput, fromSequence = 0) {
    this.router = router;
    this.events = Object.freeze(recording.events.filter(event => Number(event.sequence) >= Number(fromSequence)));
  }
  public get disposed(): boolean { return this.disposedValue; }
  public get cursor(): ReplayCursor { return Object.freeze({ finished: this.position >= this.events.length, position: this.position, remaining: Math.max(0, this.events.length - this.position) }); }
  public step(maxEvents = 1): number {
    if (this.disposedValue) return 0;
    let emitted = 0;
    const limit = Math.max(0, Math.trunc(maxEvents));
    while (this.position < this.events.length && emitted < limit) {
      const event = this.events[this.position++];
      if (!event) continue;
      this.router.setTick(event.tick);
      if (this.router.ingest(event)) { emitted += 1; this.emitted += 1; }
    }
    return emitted;
  }
  public drain(): number { return this.step(Number.MAX_SAFE_INTEGER); }
  public get emittedCount(): number { return this.emitted; }
  public dispose(): void { this.disposedValue = true; }
}

export const normalizeAxis = (value: number, deadZone = 0.08, curve = 1): number => {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  const zone = clamp(deadZone, 0, 0.95);
  if (magnitude <= zone) return 0;
  const remapped = clamp((magnitude - zone) / Math.max(0.001, 1 - zone), 0, 1);
  return Math.sign(value) * Math.pow(remapped, Math.max(0.1, curve));
};

export const normalizeButton = (value: number | boolean): number => {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
};

export const axis2 = (x: number, y: number, deadZone = 0.08, curve = 1): readonly [number, number] => Object.freeze([normalizeAxis(x, deadZone, curve), normalizeAxis(y, deadZone, curve)]);
export const axis3 = (x: number, y: number, z: number, deadZone = 0.08, curve = 1): readonly [number, number, number] => Object.freeze([normalizeAxis(x, deadZone, curve), normalizeAxis(y, deadZone, curve), normalizeAxis(z, deadZone, curve)]);

const transformInput = (definition: InputActionDefinition, value: InputValue, binding: Binding): InputValue => {
  const scale = binding.invert ? -(binding.scale ?? 1) : (binding.scale ?? 1);
  if (definition.type === 'button') {
    const numeric = typeof value === 'boolean' ? (value ? 1 : 0) : Array.isArray(value) ? Number(value[0] ?? 0) : Number(value);
    return normalizeButton(numeric * scale);
  }
  if (definition.type === 'axis1d') {
    const numeric = Array.isArray(value) ? Number(value[clamp(binding.axis ?? 0, 0, value.length - 1)] ?? 0) : typeof value === 'boolean' ? (value ? 1 : 0) : Number(value);
    return normalizeAxis(numeric * scale, definition.deadZone, definition.curve);
  }
  if (definition.type === 'axis2d') {
    const pair = Array.isArray(value) ? [Number(value[0] ?? 0), Number(value[1] ?? 0)] : [Number(value), 0];
    return axis2(pair[0] * scale, pair[1] * scale, definition.deadZone, definition.curve);
  }
  const triple = Array.isArray(value) ? [Number(value[0] ?? 0), Number(value[1] ?? 0), Number(value[2] ?? 0)] : [Number(value), 0, 0];
  return axis3(triple[0] * scale, triple[1] * scale, triple[2] * scale, definition.deadZone, definition.curve);
};

const applyState = (state: MutableActionState, value: InputValue, event: InputEventRecord, sequence: number): void => {
  state.rawValue = event.value;
  state.value = value;
  state.lastSequence = sequence;
  state.lastChangedAt = event.timestamp;
  const previousActive = activeValue(state.value, state.definition.type);
  const nextActive = activeValue(value, state.definition.type);
  const wasHeld = state.held;
  const pressed = event.phase === 'pressed' || (!wasHeld && nextActive > 0.01);
  const released = event.phase === 'released' || (wasHeld && nextActive <= 0.01);
  state.changed = true;
  state.pressed = pressed;
  state.released = released;
  state.held = nextActive > 0.01;
  if (pressed) state.phase = 'pressed';
  else if (released) state.phase = 'released';
  else if (state.held) state.phase = 'held';
  else state.phase = previousActive !== nextActive ? 'changed' : 'changed';
};

const activeValue = (value: InputValue, type: InputActionDefinition['type']): number => {
  if (type === 'button' || type === 'axis1d') return Math.abs(typeof value === 'boolean' ? (value ? 1 : 0) : Array.isArray(value) ? Number(value[0] ?? 0) : Number(value));
  if (Array.isArray(value)) return Math.min(1, Math.hypot(Number(value[0] ?? 0), Number(value[1] ?? 0), type === 'axis3d' ? Number(value[2] ?? 0) : 0));
  return Math.abs(Number(value));
};

const zeroFor = (type: InputActionDefinition['type']): InputValue => type === 'button' || type === 'axis1d' ? 0 : type === 'axis2d' ? Object.freeze([0, 0]) : Object.freeze([0, 0, 0]);
const freezeAction = (name: ActionName, state: MutableActionState): ActionState => Object.freeze({ name, type: state.definition.type, phase: state.phase, value: cloneValue(state.value), rawValue: cloneValue(state.rawValue), changed: state.changed, pressed: state.pressed, held: state.held, released: state.released, lastSequence: state.lastSequence, lastChangedAt: state.lastChangedAt });
const cloneValue = (value: InputValue): InputValue => Array.isArray(value) ? Object.freeze([...value] as number[] as never) : value;
const bindingEqual = (a: Binding, b: Binding): boolean => a.action === b.action && a.device === b.device && a.code === b.code && a.context === b.context && a.axis === b.axis && Boolean(a.invert) === Boolean(b.invert) && Number(a.scale ?? 1) === Number(b.scale ?? 1);
const contextActive = (context: string | undefined, stack: readonly string[]): boolean => !context || stack.includes(context);
const chordActive = (chord: readonly string[] | undefined, history: readonly InputEventRecord[]): boolean => !chord || chord.length === 0 || chord.every(code => { for (let index = history.length - 1; index >= 0 && index >= history.length - 32; index -= 1) if (history[index]?.code === code && history[index]?.phase !== 'released') return true; return false; });
const fnv1a = (value: string): string => { let hash = 2166136261 >>> 0; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0'); };

export const createDefaultInputRouter = (): InputRouter => {
  const router = new InputRouter();
  const buttons: readonly [string, string][] = [
    ['move.forward', 'KeyW'], ['move.backward', 'KeyS'], ['move.left', 'KeyA'], ['move.right', 'KeyD'],
    ['action.primary', 'Mouse0'], ['action.secondary', 'Mouse2'], ['jump', 'Space'], ['sprint', 'ShiftLeft'],
    ['inventory', 'KeyI'], ['map', 'KeyM'], ['pause', 'Escape'], ['interact', 'KeyE'], ['attack', 'Mouse0'],
  ];
  for (const [name] of buttons) router.defineAction({ name, type: 'button', repeatMs: 150 });
  for (const [name, code] of buttons) router.bind({ action: name, device: code.startsWith('Mouse') ? 'mouse' : 'keyboard', code });
  router.defineAction({ name: 'move.axis', type: 'axis2d', deadZone: 0.12, curve: 1.35 });
  router.bind({ action: 'move.axis', device: 'gamepad', code: 'LeftStick', priority: 10 });
  router.defineAction({ name: 'camera.look', type: 'axis2d', deadZone: 0.03, curve: 1.1, sensitivity: 1 });
  router.bind({ action: 'camera.look', device: 'mouse', code: 'movement', scale: 0.012 });
  router.bind({ action: 'camera.look', device: 'gamepad', code: 'RightStick', priority: 10 });
  return router;
};
