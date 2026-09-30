import type { FrameId, QualityTier, UnixMillis } from './types';
import { checksum } from './deterministic';
import type { InputActionEvent, ReplayFrame, ReplayHeader, ReplayRecording, RuntimeAction, RuntimeInputSource } from './runtimeContracts';
import { clampFinite, freezeInputEvent, freezeReplay, normalizeAxis } from './runtimeContracts';

export type BindingCode = string;

export interface ActionBinding {
  readonly action: RuntimeAction;
  readonly codes: readonly BindingCode[];
  readonly source: RuntimeInputSource;
  readonly scale?: number;
  readonly axis?: 'x' | 'y';
  readonly deadZone?: number;
  readonly invert?: boolean;
}

export interface ActionMapOptions {
  readonly now?: () => UnixMillis;
  readonly bindings?: readonly ActionBinding[];
}

const DEFAULT_BINDINGS: readonly ActionBinding[] = Object.freeze([
  { action: 'move.forward', codes: ['KeyW', 'ArrowUp'], source: 'keyboard', scale: 1, axis: 'y' },
  { action: 'move.backward', codes: ['KeyS', 'ArrowDown'], source: 'keyboard', scale: -1, axis: 'y' },
  { action: 'move.left', codes: ['KeyA', 'ArrowLeft'], source: 'keyboard', scale: -1, axis: 'x' },
  { action: 'move.right', codes: ['KeyD', 'ArrowRight'], source: 'keyboard', scale: 1, axis: 'x' },
  { action: 'move.sprint', codes: ['ShiftLeft', 'ShiftRight'], source: 'keyboard' },
  { action: 'move.jump', codes: ['Space'], source: 'keyboard' },
  { action: 'interaction.primary', codes: ['KeyE', 'Enter'], source: 'keyboard' },
  { action: 'interaction.secondary', codes: ['Escape', 'Backspace'], source: 'keyboard' },
  { action: 'ui.pause', codes: ['Escape', 'KeyP'], source: 'keyboard' },
  { action: 'ui.inventory', codes: ['KeyI'], source: 'keyboard' },
  { action: 'ui.map', codes: ['KeyM'], source: 'keyboard' },
  { action: 'ui.settings', codes: ['F10'], source: 'keyboard' },
  { action: 'debug.toggle', codes: ['F2'], source: 'keyboard' },
]);

interface MutableActionState {
  value: number;
  pressed: boolean;
  released: boolean;
  timestamp: UnixMillis;
  source: RuntimeInputSource | null;
}

export interface ActionState {
  readonly value: number;
  readonly pressed: boolean;
  readonly released: boolean;
  readonly timestamp: UnixMillis;
  readonly source: RuntimeInputSource | null;
}

export interface InputSnapshot {
  readonly frame: FrameId;
  readonly timestamp: UnixMillis;
  readonly actions: Readonly<Record<RuntimeAction, ActionState>>;
}

const ALL_ACTIONS: readonly RuntimeAction[] = Object.freeze([
  'move.forward', 'move.backward', 'move.left', 'move.right', 'move.sprint', 'move.jump',
  'camera.orbit.left', 'camera.orbit.right', 'camera.zoom.in', 'camera.zoom.out',
  'interaction.primary', 'interaction.secondary', 'ui.pause', 'ui.inventory', 'ui.map',
  'ui.settings', 'debug.toggle',
]);

function createEmptyState(): MutableActionState {
  return { value: 0, pressed: false, released: false, timestamp: 0, source: null };
}

function sanitizeBinding(binding: ActionBinding): ActionBinding {
  return Object.freeze({
    action: binding.action,
    codes: Object.freeze([...new Set(binding.codes.filter(Boolean))]),
    source: binding.source,
    scale: clampFinite(binding.scale ?? 1, -4, 4, 1),
    ...(binding.axis ? { axis: binding.axis } : {}),
    deadZone: clampFinite(binding.deadZone ?? 0.08, 0, 0.5, 0.08),
    invert: Boolean(binding.invert),
  });
}

/** Deterministic action map that normalizes keyboard, touch and programmatic events into one API. */
export class ActionMap {
  #now: () => UnixMillis;
  #bindings = new Map<BindingCode, ActionBinding[]>();
  #states = new Map<RuntimeAction, MutableActionState>();
  #frame = 0;
  #listeners = new Set<(event: InputActionEvent) => void>();

  constructor(options: ActionMapOptions = {}) {
    this.#now = options.now ?? (() => Date.now() as UnixMillis);
    for (const action of ALL_ACTIONS) this.#states.set(action, createEmptyState());
    for (const binding of options.bindings ?? DEFAULT_BINDINGS) this.bind(binding);
  }

  bind(binding: ActionBinding): void {
    const normalized = sanitizeBinding(binding);
    for (const code of normalized.codes) {
      const current = this.#bindings.get(code) ?? [];
      current.push(normalized);
      this.#bindings.set(code, current);
    }
  }

  unbind(action: RuntimeAction): void {
    for (const [code, bindings] of this.#bindings) {
      const remaining = bindings.filter((binding) => binding.action !== action);
      if (remaining.length) this.#bindings.set(code, remaining);
      else this.#bindings.delete(code);
    }
    this.#states.set(action, createEmptyState());
  }

  beginFrame(frame: FrameId): void {
    this.#frame = frame;
    for (const state of this.#states.values()) {
      state.pressed = false;
      state.released = false;
    }
  }

  handleDigital(code: BindingCode, down: boolean, source: RuntimeInputSource = 'keyboard', repeat = false): readonly InputActionEvent[] {
    const bindings = this.#bindings.get(code) ?? [];
    const events: InputActionEvent[] = [];
    const timestamp = this.#now();
    for (const binding of bindings) {
      const state = this.#states.get(binding.action) ?? createEmptyState();
      this.#states.set(binding.action, state);
      const wasDown = state.value !== 0;
      if (down) {
        state.value = binding.invert ? -1 : 1;
        state.timestamp = timestamp;
        state.source = source;
        if (!wasDown || repeat) state.pressed = true;
      } else {
        state.value = 0;
        state.timestamp = timestamp;
        state.source = source;
        if (wasDown) state.released = true;
      }
      const event = freezeInputEvent({
        action: binding.action,
        source,
        phase: down ? 'pressed' : 'released',
        value: state.value,
        timestamp,
        frame: this.#frame,
        repeat,
      });
      events.push(event);
      for (const listener of this.#listeners) listener(event);
    }
    return Object.freeze(events);
  }

  handleAxis(action: RuntimeAction, value: number, source: RuntimeInputSource, frame = this.#frame): InputActionEvent {
    const state = this.#states.get(action) ?? createEmptyState();
    const timestamp = this.#now();
    const normalized = normalizeAxis(value, 0.05);
    state.value = normalized;
    state.timestamp = timestamp;
    state.source = source;
    const event = freezeInputEvent({ action, source, phase: 'value', value: normalized, timestamp, frame, repeat: false });
    for (const listener of this.#listeners) listener(event);
    return event;
  }

  addListener(listener: (event: InputActionEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  snapshot(): InputSnapshot {
    const actions = {} as Record<RuntimeAction, ActionState>;
    for (const action of ALL_ACTIONS) {
      const state = this.#states.get(action) ?? createEmptyState();
      actions[action] = Object.freeze({ ...state });
    }
    return Object.freeze({ frame: this.#frame, timestamp: this.#now(), actions: Object.freeze(actions) });
  }

  value(action: RuntimeAction): number {
    return this.#states.get(action)?.value ?? 0;
  }

  wasPressed(action: RuntimeAction): boolean {
    return this.#states.get(action)?.pressed ?? false;
  }

  wasReleased(action: RuntimeAction): boolean {
    return this.#states.get(action)?.released ?? false;
  }

  clear(): void {
    for (const action of ALL_ACTIONS) this.#states.set(action, createEmptyState());
  }

  bindings(): readonly ActionBinding[] {
    const unique = new Map<string, ActionBinding>();
    for (const binding of this.#bindings.values()) {
      for (const entry of binding) unique.set(`${entry.action}:${entry.source}:${entry.codes.join(',')}`, entry);
    }
    return Object.freeze([...unique.values()].map((entry) => Object.freeze({ ...entry, codes: Object.freeze([...entry.codes]) })));
  }
}

export interface ReplayRecorderOptions {
  readonly seed: number;
  readonly fixedStepMs: number;
  readonly runtimeVersion?: string;
  readonly maxFrames?: number;
  readonly now?: () => UnixMillis;
}

/** Bounded replay recorder. It stores only normalized action events, making recordings small and deterministic. */
export class ReplayRecorder {
  readonly maxFrames: number;
  readonly seed: number;
  readonly fixedStepMs: number;
  readonly runtimeVersion: string;
  #now: () => UnixMillis;
  #frames: ReplayFrame[] = [];
  #current: InputActionEvent[] = [];
  #recording = false;
  #startFrame = 0;
  #startedAt = 0;

  constructor(options: ReplayRecorderOptions) {
    this.maxFrames = Math.max(60, Math.trunc(options.maxFrames ?? 108_000));
    this.seed = options.seed;
    this.fixedStepMs = options.fixedStepMs;
    this.runtimeVersion = options.runtimeVersion ?? 'aapw-modern-runtime';
    this.#now = options.now ?? (() => Date.now() as UnixMillis);
  }

  start(frame: FrameId): void {
    this.#frames = [];
    this.#current = [];
    this.#recording = true;
    this.#startFrame = frame;
    this.#startedAt = this.#now();
  }

  capture(event: InputActionEvent): void {
    if (!this.#recording) return;
    if (this.#frames.length >= this.maxFrames) {
      this.stop();
      return;
    }
    this.#current.push(freezeInputEvent(event));
  }

  commitFrame(frame: FrameId, timestamp = this.#now()): void {
    if (!this.#recording) return;
    if (this.#current.length) this.#frames.push(Object.freeze({ frame, timestamp, actions: Object.freeze([...this.#current]) }));
    this.#current = [];
    if (this.#frames.length >= this.maxFrames) this.stop();
  }

  stop(): ReplayRecording | null {
    if (!this.#recording) return null;
    if (this.#current.length) this.commitFrame(this.#frames[this.#frames.length - 1]?.frame ?? this.#startFrame);
    this.#recording = false;
    const header: ReplayHeader = Object.freeze({
      schema: 'aapw.replay',
      version: 2,
      seed: this.seed,
      fixedStepMs: this.fixedStepMs,
      createdAt: this.#startedAt,
      runtimeVersion: this.runtimeVersion,
    });
    const base = { header, frames: Object.freeze([...this.#frames]) };
    return freezeReplay({ ...base, checksum: checksum(base) });
  }

  get recording(): boolean {
    return this.#recording;
  }

  get frameCount(): number {
    return this.#frames.length;
  }
}

export interface ReplayPlayerOptions {
  readonly onEvent: (event: InputActionEvent) => void;
  readonly strictSeed?: number;
  readonly strictFixedStepMs?: number;
}

/** Tick-driven replay player with strict header validation and seek support. */
export class ReplayPlayer {
  #recording: ReplayRecording | null = null;
  #frameIndex = 0;
  #onEvent: (event: InputActionEvent) => void;
  #strictSeed?: number;
  #strictFixedStepMs?: number;
  #playing = false;

  constructor(options: ReplayPlayerOptions) {
    this.#onEvent = options.onEvent;
    this.#strictSeed = options.strictSeed;
    this.#strictFixedStepMs = options.strictFixedStepMs;
  }

  load(recording: ReplayRecording): boolean {
    if (recording.header.schema !== 'aapw.replay' || recording.header.version < 1) return false;
    if (this.#strictSeed !== undefined && recording.header.seed !== this.#strictSeed) return false;
    if (this.#strictFixedStepMs !== undefined && Math.abs(recording.header.fixedStepMs - this.#strictFixedStepMs) > 0.0001) return false;
    if (checksum({ header: recording.header, frames: recording.frames }) !== recording.checksum) return false;
    this.#recording = freezeReplay(recording);
    this.#frameIndex = 0;
    this.#playing = false;
    return true;
  }

  play(): boolean {
    if (!this.#recording) return false;
    this.#playing = true;
    return true;
  }

  pause(): void {
    this.#playing = false;
  }

  stop(): void {
    this.#playing = false;
    this.#frameIndex = 0;
  }

  seek(frameIndex: number): void {
    const length = this.#recording?.frames.length ?? 0;
    this.#frameIndex = Math.max(0, Math.min(length, Math.trunc(frameIndex)));
  }

  tick(frame: FrameId): boolean {
    if (!this.#playing || !this.#recording) return false;
    let consumed = false;
    while (this.#frameIndex < this.#recording.frames.length) {
      const replayFrame = this.#recording.frames[this.#frameIndex];
      if (!replayFrame || replayFrame.frame > frame) break;
      for (const event of replayFrame.actions) this.#onEvent(event);
      this.#frameIndex += 1;
      consumed = true;
    }
    if (this.#frameIndex >= this.#recording.frames.length) this.#playing = false;
    return consumed;
  }

  get playing(): boolean { return this.#playing; }
  get finished(): boolean { return Boolean(this.#recording) && !this.#playing && this.#frameIndex >= (this.#recording?.frames.length ?? 0); }
  get currentIndex(): number { return this.#frameIndex; }
  get recording(): ReplayRecording | null { return this.#recording; }
}

export interface InputContext {
  readonly quality: QualityTier;
  readonly touch: boolean;
  readonly reducedMotion: boolean;
}

/** Produces a stable movement vector from action values regardless of input device. */
export function movementVector(map: ActionMap, context: InputContext): { x: number; y: number; sprint: boolean; jump: boolean } {
  const sensitivity = context.touch ? 0.9 : 1;
  let x = (map.value('move.right') + map.value('move.left')) * sensitivity;
  let y = (map.value('move.forward') + map.value('move.backward')) * sensitivity;
  const length = Math.hypot(x, y);
  if (length > 1) { x /= length; y /= length; }
  const reducedMotionScale = context.reducedMotion ? 0.85 : 1;
  return Object.freeze({
    x: x * reducedMotionScale,
    y: y * reducedMotionScale,
    sprint: map.value('move.sprint') !== 0,
    jump: map.wasPressed('move.jump'),
  });
}
