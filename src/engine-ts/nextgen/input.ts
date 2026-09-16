import { InputAction, InputCommand, InputFrame, Tick, Vec2, asTick, clamp, normalize2, stableJson, hashString } from './contracts.ts';

const ACTIONS: readonly InputAction[] = ['move', 'look', 'jump', 'sprint', 'dodge', 'lightAttack', 'heavyAttack', 'block', 'interact', 'inventory', 'map', 'pause'];

export interface RawInputState {
  readonly moveX?: number;
  readonly moveY?: number;
  readonly lookX?: number;
  readonly lookY?: number;
  readonly held?: readonly InputAction[];
  readonly pressed?: readonly InputAction[];
  readonly released?: readonly InputAction[];
}

export interface InputMapping {
  readonly action: InputAction;
  readonly bindings: readonly string[];
  readonly deadZone: number;
  readonly scale: number;
}

export interface InputSnapshot {
  readonly tick: Tick;
  readonly sequence: number;
  readonly move: Vec2;
  readonly look: Vec2;
  readonly held: readonly InputAction[];
  readonly pressed: readonly InputAction[];
  readonly released: readonly InputAction[];
  readonly checksum: string;
}

const freeze = <T>(value: T): T => Object.freeze(value);

export const DEFAULT_INPUT_MAPPINGS: readonly InputMapping[] = freeze(ACTIONS.map((action) => freeze({
  action,
  bindings: freeze([] as string[]),
  deadZone: action === 'move' || action === 'look' ? 0.12 : 0,
  scale: 1,
})));

const cleanActions = (values: readonly InputAction[] | undefined): readonly InputAction[] => freeze([...new Set((values ?? []).filter((item) => ACTIONS.includes(item)))]);
const cleanAxis = (value: number | undefined): number => clamp(value ?? 0, -1, 1);

export const normalizeRawInput = (raw: RawInputState): Omit<InputSnapshot, 'tick' | 'sequence' | 'checksum'> => {
  const move = normalize2({ x: cleanAxis(raw.moveX), y: cleanAxis(raw.moveY) });
  const look = normalize2({ x: cleanAxis(raw.lookX), y: cleanAxis(raw.lookY) });
  return freeze({ move, look, held: cleanActions(raw.held), pressed: cleanActions(raw.pressed), released: cleanActions(raw.released) });
};

export class InputBuffer {
  readonly #capacity: number;
  readonly #frames = new Map<number, InputSnapshot>();
  #sequence = 0;

  constructor(capacity = 256) { this.#capacity = Math.max(8, Math.floor(capacity)); }

  push(tick: number, raw: RawInputState): InputSnapshot {
    const normalized = normalizeRawInput(raw);
    const snapshot: InputSnapshot = freeze({
      ...normalized,
      tick: asTick(tick),
      sequence: ++this.#sequence,
      checksum: hashString(stableJson({ tick, sequence: this.#sequence, ...normalized })),
    });
    this.#frames.set(Number(snapshot.tick), snapshot);
    while (this.#frames.size > this.#capacity) {
      const oldest = this.#frames.keys().next().value;
      if (oldest === undefined) break;
      this.#frames.delete(oldest);
    }
    return snapshot;
  }

  get(tick: Tick): InputSnapshot | undefined { return this.#frames.get(Number(tick)); }
  range(fromTick: Tick, toTick: Tick): readonly InputSnapshot[] { return freeze([...this.#frames.values()].filter((frame) => frame.tick >= fromTick && frame.tick <= toTick).sort((a, b) => a.tick - b.tick)); }
  clear(): void { this.#frames.clear(); }
  get size(): number { return this.#frames.size; }
  get latest(): InputSnapshot | undefined { return [...this.#frames.values()].at(-1); }
}

export class InputRecorder {
  readonly #commands: InputCommand[] = [];
  #sequence = 0;

  record(frame: InputSnapshot): readonly InputCommand[] {
    const commands: InputCommand[] = [];
    if (Math.abs(frame.move.x) > 0.001 || Math.abs(frame.move.y) > 0.001) commands.push({ sequence: ++this.#sequence, tick: frame.tick, action: 'move', value: 1, x: frame.move.x, y: frame.move.y });
    if (Math.abs(frame.look.x) > 0.001 || Math.abs(frame.look.y) > 0.001) commands.push({ sequence: ++this.#sequence, tick: frame.tick, action: 'look', value: 1, x: frame.look.x, y: frame.look.y });
    for (const action of frame.pressed) commands.push({ sequence: ++this.#sequence, tick: frame.tick, action, value: 1 });
    for (const action of frame.released) commands.push({ sequence: ++this.#sequence, tick: frame.tick, action, value: 0 });
    this.#commands.push(...commands);
    return freeze(commands);
  }

  commands(): readonly InputCommand[] { return freeze([...this.#commands]); }
  since(tick: Tick): readonly InputCommand[] { return freeze(this.#commands.filter((command) => command.tick >= tick)); }
  checksum(): string { return hashString(stableJson(this.#commands)); }
  clear(): void { this.#commands.length = 0; this.#sequence = 0; }
}

export class InputReplay {
  readonly #commands: readonly InputCommand[];
  #cursor = 0;

  constructor(commands: readonly InputCommand[]) { this.#commands = freeze([...commands].sort((a, b) => a.tick - b.tick || a.sequence - b.sequence)); }

  commandsForTick(tick: Tick): readonly InputCommand[] {
    while (this.#cursor < this.#commands.length && this.#commands[this.#cursor]!.tick < tick) this.#cursor += 1;
    const start = this.#cursor;
    while (this.#cursor < this.#commands.length && this.#commands[this.#cursor]!.tick === tick) this.#cursor += 1;
    return freeze(this.#commands.slice(start, this.#cursor));
  }

  reset(): void { this.#cursor = 0; }
  get done(): boolean { return this.#cursor >= this.#commands.length; }
}

export const inputFrameFromCommands = (tick: Tick, commands: readonly InputCommand[]): InputFrame => {
  let move = { x: 0, y: 0 };
  let look = { x: 0, y: 0 };
  const held = new Set<InputAction>();
  const pressed = new Set<InputAction>();
  const released = new Set<InputAction>();
  for (const command of commands) {
    if (command.action === 'move') move = { x: clamp(command.x ?? 0, -1, 1), y: clamp(command.y ?? 0, -1, 1) };
    else if (command.action === 'look') look = { x: clamp(command.x ?? 0, -1, 1), y: clamp(command.y ?? 0, -1, 1) };
    else if (command.value > 0) { held.add(command.action); pressed.add(command.action); }
    else { held.delete(command.action); released.add(command.action); }
  }
  return freeze({ tick, sequence: commands.at(-1)?.sequence ?? 0, move, look, held, pressed, released });
};
