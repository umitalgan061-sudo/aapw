/**
 * AAPW Input Pipeline V18.
 *
 * Browser-input neutral semantic pipeline. Raw device signals are normalized once,
 * validated, sequenced and converted into deterministic commands. The pipeline keeps
 * rendering and gameplay independent from DOM event shape.
 */

export type InputDeviceV18 =
  | 'keyboard'
  | 'pointer'
  | 'touch'
  | 'gamepad'
  | 'programmatic';

export type InputActionV18 =
  | 'move-forward'
  | 'move-backward'
  | 'move-left'
  | 'move-right'
  | 'sprint'
  | 'dodge'
  | 'jump'
  | 'attack-light'
  | 'attack-heavy'
  | 'block'
  | 'interact'
  | 'map'
  | 'pause'
  | 'camera-reset';

export type InputPhaseV18 = 'pressed' | 'released' | 'repeated' | 'axis';

export interface RawInputEventV18 {
  readonly device: InputDeviceV18;
  readonly code?: string;
  readonly action?: InputActionV18;
  readonly phase: InputPhaseV18;
  readonly value?: number;
  readonly x?: number;
  readonly y?: number;
  readonly timestampMs: number;
  readonly sequence?: number;
}

export interface InputCommandV18 {
  readonly id: number;
  readonly tick: number;
  readonly device: InputDeviceV18;
  readonly action: InputActionV18;
  readonly phase: InputPhaseV18;
  readonly value: number;
  readonly x: number;
  readonly y: number;
  readonly timestampMs: number;
  readonly sequence: number;
}

export interface InputSnapshotV18 {
  readonly tick: number;
  readonly sequence: number;
  readonly queueSize: number;
  readonly dropped: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly activeActions: readonly InputActionV18[];
  readonly axes: Readonly<Record<string, number>>;
}

export interface InputPipelineOptionsV18 {
  readonly maxQueue?: number;
  readonly maxFutureTicks?: number;
  readonly maxAgeTicks?: number;
  readonly maxAxisMagnitude?: number;
  readonly maxCommandsPerTick?: number;
  readonly repeatWindowMs?: number;
  readonly now?: () => number;
}

interface PendingCommandV18 {
  readonly command: InputCommandV18;
  readonly dueTick: number;
}

const ACTIONS: readonly InputActionV18[] = [
  'move-forward',
  'move-backward',
  'move-left',
  'move-right',
  'sprint',
  'dodge',
  'jump',
  'attack-light',
  'attack-heavy',
  'block',
  'interact',
  'map',
  'pause',
  'camera-reset',
];

const KEY_TO_ACTION: Readonly<Record<string, InputActionV18>> = {
  KeyW: 'move-forward',
  ArrowUp: 'move-forward',
  KeyS: 'move-backward',
  ArrowDown: 'move-backward',
  KeyA: 'move-left',
  ArrowLeft: 'move-left',
  KeyD: 'move-right',
  ArrowRight: 'move-right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  Space: 'jump',
  KeyQ: 'dodge',
  KeyE: 'interact',
  KeyM: 'map',
  Escape: 'pause',
  KeyR: 'camera-reset',
  Mouse0: 'attack-light',
  Mouse2: 'block',
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function finite(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function integer(value: number | undefined, fallback = 0): number {
  return Math.trunc(finite(value, fallback));
}

function action(value: string | undefined): InputActionV18 | undefined {
  return ACTIONS.includes(value as InputActionV18)
    ? (value as InputActionV18)
    : undefined;
}

function normalizeAxis(x: number, y: number, cap: number): { x: number; y: number } {
  const nx = finite(x);
  const ny = finite(y);
  const length = Math.hypot(nx, ny);
  if (length <= cap || length === 0) {
    return { x: nx, y: ny };
  }
  const scale = cap / length;
  return { x: nx * scale, y: ny * scale };
}

function stableKey(event: RawInputEventV18): string {
  return [
    event.device,
    event.action ?? '',
    event.code ?? '',
    event.phase,
    event.value ?? 0,
    event.x ?? 0,
    event.y ?? 0,
  ].join('|');
}

export class InputPipelineV18 {
  readonly #maxQueue: number;
  readonly #maxFutureTicks: number;
  readonly #maxAgeTicks: number;
  readonly #maxAxisMagnitude: number;
  readonly #maxCommandsPerTick: number;
  readonly #repeatWindowMs: number;
  readonly #now: () => number;

  #tick = 0;
  #nextId = 1;
  #sequence = 0;
  #dropped = 0;
  #accepted = 0;
  #rejected = 0;

  #queue: PendingCommandV18[] = [];
  #active = new Set<InputActionV18>();
  #axes = new Map<string, number>();
  #lastRepeat = new Map<string, number>();

  public constructor(options: InputPipelineOptionsV18 = {}) {
    this.#maxQueue = Math.max(32, integer(options.maxQueue, 2048));
    this.#maxFutureTicks = Math.max(1, integer(options.maxFutureTicks, 8));
    this.#maxAgeTicks = Math.max(1, integer(options.maxAgeTicks, 30));
    this.#maxAxisMagnitude = clamp(finite(options.maxAxisMagnitude, 1), 0.1, 4);
    this.#maxCommandsPerTick = Math.max(
      1,
      integer(options.maxCommandsPerTick, 32),
    );
    this.#repeatWindowMs = Math.max(0, finite(options.repeatWindowMs, 50));
    this.#now = options.now ?? (() => performance.now());
  }

  public setTick(tick: number): void {
    this.#tick = Math.max(0, integer(tick));
    this.#prune();
  }

  public normalizeKeyboard(
    code: string,
    phase: InputPhaseV18,
    timestampMs = this.#now(),
  ): RawInputEventV18 | null {
    const mapped = KEY_TO_ACTION[code];
    if (!mapped) return null;

    return Object.freeze({
      device: 'keyboard',
      code,
      action: mapped,
      phase,
      value: phase === 'released' ? 0 : 1,
      x: 0,
      y: 0,
      timestampMs: finite(timestampMs),
    });
  }

  public normalizePointer(
    button: number,
    phase: InputPhaseV18,
    timestampMs = this.#now(),
  ): RawInputEventV18 | null {
    const mapped = KEY_TO_ACTION[`Mouse${integer(button)}`];
    if (!mapped) return null;

    return Object.freeze({
      device: 'pointer',
      code: `Mouse${integer(button)}`,
      action: mapped,
      phase,
      value: phase === 'released' ? 0 : 1,
      x: 0,
      y: 0,
      timestampMs: finite(timestampMs),
    });
  }

  public normalizeTouch(
    x: number,
    y: number,
    magnitude = 1,
    timestampMs = this.#now(),
  ): RawInputEventV18 {
    const axes = normalizeAxis(
      x,
      y,
      Math.max(0.1, this.#maxAxisMagnitude),
    );

    return Object.freeze({
      device: 'touch',
      phase: 'axis',
      action: 'move-forward',
      value: clamp(finite(magnitude, 1), 0, this.#maxAxisMagnitude),
      x: axes.x,
      y: axes.y,
      timestampMs: finite(timestampMs),
    });
  }

  public normalizeGamepad(
    actionName: string,
    phase: InputPhaseV18,
    value = 1,
    x = 0,
    y = 0,
    timestampMs = this.#now(),
  ): RawInputEventV18 | null {
    const mapped = action(actionName);
    if (!mapped) return null;

    const axes = normalizeAxis(x, y, this.#maxAxisMagnitude);
    return Object.freeze({
      device: 'gamepad',
      action: mapped,
      phase,
      value: clamp(finite(value, 0), -this.#maxAxisMagnitude, this.#maxAxisMagnitude),
      x: axes.x,
      y: axes.y,
      timestampMs: finite(timestampMs),
    });
  }

  public enqueue(
    event: RawInputEventV18,
    targetTick = this.#tick,
  ): InputCommandV18 | null {
    const normalized = this.#normalizeEvent(event, targetTick);
    if (!normalized) {
      this.#rejected += 1;
      return null;
    }

    const command = normalized.command;
    const key = stableKey(event);
    const previousRepeat = this.#lastRepeat.get(key);

    if (
      event.phase === 'repeated' &&
      previousRepeat !== undefined &&
      event.timestampMs - previousRepeat < this.#repeatWindowMs
    ) {
      this.#rejected += 1;
      return null;
    }

    this.#lastRepeat.set(key, event.timestampMs);

    if (this.#queue.length >= this.#maxQueue) {
      this.#evictOne();
    }

    this.#queue.push({
      command,
      dueTick: normalized.dueTick,
    });

    this.#queue.sort(
      (a, b) =>
        a.dueTick - b.dueTick ||
        a.command.timestampMs - b.command.timestampMs ||
        a.command.sequence - b.command.sequence,
    );

    this.#accepted += 1;
    this.#applyActiveState(command);
    return command;
  }

  public enqueueBatch(
    events: readonly RawInputEventV18[],
    targetTick = this.#tick,
  ): readonly InputCommandV18[] {
    const accepted: InputCommandV18[] = [];
    for (const event of events) {
      const command = this.enqueue(event, targetTick);
      if (command) accepted.push(command);
    }
    return Object.freeze(accepted);
  }

  public drain(maxCommands = this.#maxCommandsPerTick): readonly InputCommandV18[] {
    const limit = Math.max(1, integer(maxCommands, this.#maxCommandsPerTick));
    const ready: InputCommandV18[] = [];
    const remaining: PendingCommandV18[] = [];

    for (const pending of this.#queue) {
      if (ready.length >= limit) {
        remaining.push(pending);
        continue;
      }
      if (pending.dueTick > this.#tick) {
        remaining.push(pending);
        continue;
      }

      ready.push(pending.command);
      this.#applyActiveState(pending.command);
    }

    this.#queue = remaining;
    this.#sequence += ready.length;
    return Object.freeze(ready);
  }

  public drainUntil(tick: number, maxCommands = this.#maxCommandsPerTick): readonly InputCommandV18[] {
    const previous = this.#tick;
    this.#tick = Math.max(previous, integer(tick));
    const result = this.drain(maxCommands);
    this.#tick = previous;
    return result;
  }

  public clear(): void {
    this.#queue = [];
    this.#active.clear();
    this.#axes.clear();
  }

  public isActive(actionName: InputActionV18): boolean {
    return this.#active.has(actionName);
  }

  public axis(name: string): number {
    return this.#axes.get(name) ?? 0;
  }

  public snapshot(): InputSnapshotV18 {
    const axes = Object.fromEntries(
      [...this.#axes.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );

    return Object.freeze({
      tick: this.#tick,
      sequence: this.#sequence,
      queueSize: this.#queue.length,
      dropped: this.#dropped,
      accepted: this.#accepted,
      rejected: this.#rejected,
      activeActions: Object.freeze([...this.#active].sort()),
      axes: Object.freeze(axes),
    });
  }

  #normalizeEvent(
    event: RawInputEventV18,
    targetTick: number,
  ): { command: InputCommandV18; dueTick: number } | null {
    const mapped = action(event.action);
    if (!mapped) return null;
    if (!Number.isFinite(event.timestampMs) || event.timestampMs < 0) return null;

    const requestedTick = Math.max(0, integer(targetTick, this.#tick));
    if (requestedTick > this.#tick + this.#maxFutureTicks) return null;
    if (requestedTick + this.#maxAgeTicks < this.#tick) return null;

    const axes = normalizeAxis(
      event.x ?? 0,
      event.y ?? 0,
      this.#maxAxisMagnitude,
    );

    const command: InputCommandV18 = Object.freeze({
      id: this.#nextId++,
      tick: requestedTick,
      device: event.device,
      action: mapped,
      phase: event.phase,
      value: clamp(finite(event.value, 0), -this.#maxAxisMagnitude, this.#maxAxisMagnitude),
      x: axes.x,
      y: axes.y,
      timestampMs: Math.max(0, finite(event.timestampMs)),
      sequence: event.sequence === undefined ? this.#sequence + this.#nextId : integer(event.sequence),
    });

    return {
      command,
      dueTick: requestedTick,
    };
  }

  #applyActiveState(command: InputCommandV18): void {
    if (command.phase === 'pressed' || command.phase === 'repeated') {
      this.#active.add(command.action);
    }
    if (command.phase === 'released') {
      this.#active.delete(command.action);
    }
    if (command.phase === 'axis') {
      const magnitude = Math.min(
        this.#maxAxisMagnitude,
        Math.hypot(command.x, command.y),
      );
      this.#axes.set(command.action, magnitude);
    }
  }

  #prune(): void {
    const minimumTick = Math.max(0, this.#tick - this.#maxAgeTicks);
    const retained: PendingCommandV18[] = [];

    for (const pending of this.#queue) {
      if (pending.dueTick < minimumTick) {
        this.#dropped += 1;
        continue;
      }
      retained.push(pending);
    }

    this.#queue = retained;
  }

  #evictOne(): void {
    if (this.#queue.length === 0) return;

    let index = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let i = 0; i < this.#queue.length; i += 1) {
      const item = this.#queue[i];
      if (!item) continue;

      const age = Math.max(0, this.#tick - item.dueTick);
      const releaseBonus = item.command.phase === 'released' ? -10 : 0;
      const score = age + releaseBonus + item.command.sequence * 1e-6;
      if (score < bestScore) {
        bestScore = score;
        index = i;
      }
    }

    this.#queue.splice(index, 1);
    this.#dropped += 1;
  }
}