/**
 * V6 typed command pipeline.
 * Normalizes device input into deterministic intent commands and applies
 * validation, sequence rules, batching, undo metadata and audit receipts.
 */

export type CommandDomain = 'movement' | 'combat' | 'camera' | 'interaction' | 'inventory' | 'ui' | 'system';
export type CommandName =
  | 'move'
  | 'look'
  | 'jump'
  | 'sprint'
  | 'dodge'
  | 'primaryAction'
  | 'secondaryAction'
  | 'interact'
  | 'equip'
  | 'unequip'
  | 'useItem'
  | 'openMenu'
  | 'closeMenu'
  | 'pause'
  | 'resume';

export interface CommandVector2 { readonly x: number; readonly y: number; }
export interface CommandVector3 { readonly x: number; readonly y: number; readonly z: number; }

export interface RawInputFrame {
  readonly tick: number;
  readonly pressed: readonly string[];
  readonly released: readonly string[];
  readonly axes: Readonly<Record<string, number>>;
  readonly pointer?: CommandVector2;
  readonly touch?: readonly { id: number; x: number; y: number; phase: 'start' | 'move' | 'end' }[];
  readonly source: 'keyboard' | 'gamepad' | 'touch' | 'mixed' | 'replay';
}

export interface CommandEnvelope<P = unknown> {
  readonly tick: number;
  readonly sequence: number;
  readonly domain: CommandDomain;
  readonly name: CommandName;
  readonly payload: P;
  readonly client: 'local' | 'replay' | 'network';
  readonly reliable: boolean;
}

export interface CommandReceipt {
  readonly accepted: boolean;
  readonly sequence: number;
  readonly reason?: string;
  readonly command?: CommandEnvelope;
}

export interface CommandPipelineConfig {
  readonly maxBatch: number;
  readonly maxHistory: number;
  readonly maxFutureTicks: number;
  readonly repeatGuardTicks: number;
  readonly deadZone: number;
}

const DEFAULT_CONFIG: CommandPipelineConfig = {
  maxBatch: 32,
  maxHistory: 512,
  maxFutureTicks: 4,
  repeatGuardTicks: 1,
  deadZone: 0.08,
};

const AXIS_NAMES = new Set(['moveX', 'moveY', 'lookX', 'lookY', 'zoom']);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function normalizeAxis(value: number, deadZone: number): number {
  const raw = clamp(finite(value), -1, 1);
  if (Math.abs(raw) <= deadZone) return 0;
  const sign = Math.sign(raw);
  return sign * ((Math.abs(raw) - deadZone) / (1 - deadZone));
}

function vectorMagnitude(v: CommandVector2): number {
  return Math.hypot(v.x, v.y);
}

function normalizeVector(v: CommandVector2): CommandVector2 {
  const magnitude = vectorMagnitude(v);
  if (magnitude <= 1) return v;
  return { x: v.x / magnitude, y: v.y / magnitude };
}

function movementFromFrame(frame: RawInputFrame, deadZone: number): CommandEnvelope<CommandVector2> | undefined {
  const x = normalizeAxis(frame.axes.moveX ?? 0, deadZone);
  const y = normalizeAxis(frame.axes.moveY ?? 0, deadZone);
  const direction = normalizeVector({ x, y });
  if (direction.x === 0 && direction.y === 0) return undefined;
  return { tick: frame.tick, sequence: 0, domain: 'movement', name: 'move', payload: direction, client: 'local', reliable: false };
}

function lookFromFrame(frame: RawInputFrame, deadZone: number): CommandEnvelope<CommandVector2> | undefined {
  const x = normalizeAxis(frame.axes.lookX ?? 0, deadZone);
  const y = normalizeAxis(frame.axes.lookY ?? 0, deadZone);
  if (x === 0 && y === 0) return undefined;
  return { tick: frame.tick, sequence: 0, domain: 'camera', name: 'look', payload: { x, y }, client: 'local', reliable: false };
}

function buttonCommands(frame: RawInputFrame): CommandEnvelope[] {
  const mapping: Readonly<Record<string, [CommandDomain, CommandName, boolean]>> = {
    Space: ['movement', 'jump', false],
    ShiftLeft: ['movement', 'sprint', false],
    KeyQ: ['movement', 'dodge', true],
    Mouse0: ['combat', 'primaryAction', true],
    Mouse1: ['combat', 'secondaryAction', true],
    KeyE: ['interaction', 'interact', true],
    KeyI: ['inventory', 'openMenu', true],
    Escape: ['system', 'pause', true],
  };
  const commands: CommandEnvelope[] = [];
  for (const key of frame.pressed) {
    const mapped = mapping[key];
    if (!mapped) continue;
    commands.push({
      tick: frame.tick,
      sequence: 0,
      domain: mapped[0],
      name: mapped[1],
      payload: null,
      client: 'local',
      reliable: mapped[2],
    });
  }
  return commands;
}

export function normalizeInputFrame(frame: RawInputFrame, deadZone = DEFAULT_CONFIG.deadZone): CommandEnvelope[] {
  if (!Number.isSafeInteger(frame.tick) || frame.tick < 0) throw new RangeError('input tick must be a non-negative safe integer');
  const move = movementFromFrame(frame, deadZone);
  const look = lookFromFrame(frame, deadZone);
  return [...(move ? [move] : []), ...(look ? [look] : []), ...buttonCommands(frame)];
}

interface UndoEntry {
  readonly sequence: number;
  readonly inverse?: CommandEnvelope;
}

export class CommandPipeline {
  readonly #config: CommandPipelineConfig;
  readonly #queue: CommandEnvelope[] = [];
  readonly #history: CommandEnvelope[] = [];
  readonly #undo: UndoEntry[] = [];
  #sequence = 0;
  #lastTick = -1;
  #lastAcceptedByName = new Map<CommandName, number>();

  constructor(config: Partial<CommandPipelineConfig> = {}) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    this.#config = {
      maxBatch: Math.max(1, Math.floor(merged.maxBatch)),
      maxHistory: Math.max(1, Math.floor(merged.maxHistory)),
      maxFutureTicks: Math.max(0, Math.floor(merged.maxFutureTicks)),
      repeatGuardTicks: Math.max(0, Math.floor(merged.repeatGuardTicks)),
      deadZone: clamp(merged.deadZone, 0, 0.5),
    };
  }

  ingest(frame: RawInputFrame, currentTick: number): readonly CommandReceipt[] {
    const commands = normalizeInputFrame(frame, this.#config.deadZone);
    return commands.map((command) => this.enqueue(command, currentTick));
  }

  enqueue<P>(input: CommandEnvelope<P>, currentTick: number): CommandReceipt {
    if (!Number.isSafeInteger(input.tick) || input.tick < 0) return { accepted: false, sequence: 0, reason: 'invalid tick' };
    if (input.tick > currentTick + this.#config.maxFutureTicks) return { accepted: false, sequence: 0, reason: 'future tick limit' };
    if (!input.name || !input.domain) return { accepted: false, sequence: 0, reason: 'invalid command identity' };
    if (this.#queue.length >= this.#config.maxBatch) return { accepted: false, sequence: 0, reason: 'queue capacity' };
    const last = this.#lastAcceptedByName.get(input.name);
    if (last !== undefined && input.tick - last <= this.#config.repeatGuardTicks && !input.reliable) {
      return { accepted: false, sequence: 0, reason: 'repeat guard' };
    }
    const command = Object.freeze({ ...input, sequence: ++this.#sequence });
    this.#queue.push(command);
    this.#queue.sort((a, b) => a.tick - b.tick || a.sequence - b.sequence);
    this.#lastAcceptedByName.set(command.name, command.tick);
    this.#lastTick = Math.max(this.#lastTick, command.tick);
    this.#pushHistory(command);
    this.#undo.push({ sequence: command.sequence });
    while (this.#undo.length > this.#config.maxHistory) this.#undo.shift();
    return { accepted: true, sequence: command.sequence, command };
  }

  drain(tick: number): readonly CommandEnvelope[] {
    const ready: CommandEnvelope[] = [];
    while (this.#queue.length > 0 && this.#queue[0]!.tick <= tick) ready.push(this.#queue.shift()!);
    return ready;
  }

  peek(): readonly CommandEnvelope[] {
    return this.#queue;
  }

  history(): readonly CommandEnvelope[] {
    return this.#history;
  }

  clear(): void {
    this.#queue.length = 0;
    this.#history.length = 0;
    this.#undo.length = 0;
    this.#lastAcceptedByName.clear();
    this.#sequence = 0;
    this.#lastTick = -1;
  }

  snapshot(): { readonly sequence: number; readonly lastTick: number; readonly queue: readonly CommandEnvelope[]; readonly history: readonly CommandEnvelope[] } {
    return { sequence: this.#sequence, lastTick: this.#lastTick, queue: [...this.#queue], history: [...this.#history] };
  }

  restore(snapshot: { readonly sequence: number; readonly lastTick: number; readonly queue: readonly CommandEnvelope[]; readonly history: readonly CommandEnvelope[] }): void {
    if (!Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0) throw new RangeError('invalid pipeline sequence');
    this.#sequence = snapshot.sequence;
    this.#lastTick = snapshot.lastTick;
    this.#queue.splice(0, this.#queue.length, ...snapshot.queue.map((command) => Object.freeze({ ...command })));
    this.#history.splice(0, this.#history.length, ...snapshot.history.map((command) => Object.freeze({ ...command })));
    this.#undo.splice(0, this.#undo.length);
    this.#lastAcceptedByName.clear();
    for (const command of this.#history) {
      const previous = this.#lastAcceptedByName.get(command.name);
      if (previous === undefined || previous < command.tick) this.#lastAcceptedByName.set(command.name, command.tick);
    }
  }

  #pushHistory(command: CommandEnvelope): void {
    this.#history.push(command);
    while (this.#history.length > this.#config.maxHistory) this.#history.shift();
  }
}

export interface InputBinding {
  readonly command: CommandName;
  readonly keys: readonly string[];
  readonly axis?: string;
  readonly threshold?: number;
}

export class InputBindingRegistry {
  readonly #bindings = new Map<CommandName, InputBinding>();

  register(binding: InputBinding): void {
    if (!binding.command || binding.keys.length > 16) throw new TypeError('invalid input binding');
    const keys = [...new Set(binding.keys.filter((key) => key.length > 0 && key.length <= 32))].sort();
    this.#bindings.set(binding.command, { ...binding, keys });
  }

  remove(command: CommandName): boolean {
    return this.#bindings.delete(command);
  }

  get(command: CommandName): InputBinding | undefined {
    const binding = this.#bindings.get(command);
    return binding ? { ...binding, keys: [...binding.keys] } : undefined;
  }

  list(): readonly InputBinding[] {
    return [...this.#bindings.values()].sort((a, b) => a.command.localeCompare(b.command));
  }

  match(keys: readonly string[]): readonly CommandName[] {
    const normalized = new Set(keys);
    return [...this.#bindings.values()]
      .filter((binding) => binding.keys.some((key) => normalized.has(key)))
      .map((binding) => binding.command)
      .sort();
  }
}

export function quantizeInput(value: number, precision = 1024): number {
  const safePrecision = Math.max(2, Math.floor(precision));
  return Math.round(clamp(finite(value), -1, 1) * safePrecision) / safePrecision;
}

export function quantizeVector(v: CommandVector3, precision = 1024): CommandVector3 {
  return { x: quantizeInput(v.x, precision), y: quantizeInput(v.y, precision), z: quantizeInput(v.z, precision) };
}

export function actionIsContinuous(command: CommandName): boolean {
  return command === 'move' || command === 'look' || command === 'sprint';
}

export function actionDomain(command: CommandName): CommandDomain {
  switch (command) {
    case 'move': case 'jump': case 'sprint': case 'dodge': return 'movement';
    case 'look': return 'camera';
    case 'primaryAction': case 'secondaryAction': return 'combat';
    case 'interact': return 'interaction';
    case 'equip': case 'unequip': case 'useItem': return 'inventory';
    case 'openMenu': case 'closeMenu': return 'ui';
    default: return 'system';
  }
}

export function assertCommandOrder(commands: readonly CommandEnvelope[]): void {
  let lastSequence = 0;
  for (const command of commands) {
    if (command.sequence <= lastSequence) throw new Error('command sequence is not strictly increasing');
    lastSequence = command.sequence;
  }
}
