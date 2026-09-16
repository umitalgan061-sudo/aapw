import { clamp, normalizeInputAxis } from './math.ts';
import { tick, type InputFrame, type Tick } from './types.ts';

export interface InputCommand {
  readonly tick: Tick;
  readonly sequence: number;
  readonly moveX: number;
  readonly moveZ: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly buttons: number;
}

export const enum InputButton {
  Jump = 1 << 0,
  Sprint = 1 << 1,
  Dodge = 1 << 2,
  Primary = 1 << 3,
  Secondary = 1 << 4,
  Interact = 1 << 5,
  Inventory = 1 << 6,
  Map = 1 << 7,
}

export class InputCommandBuffer {
  readonly capacity: number;
  #commands: InputCommand[] = [];
  #nextSequence = 1;

  constructor(capacity = 256) { this.capacity = Math.max(8, Math.floor(capacity)); }

  push(frame: InputFrame): InputCommand {
    const command: InputCommand = {
      tick: frame.tick,
      sequence: this.#nextSequence++,
      moveX: normalizeInputAxis(frame.moveX),
      moveZ: normalizeInputAxis(frame.moveZ),
      lookX: clamp(frame.lookX, -1, 1),
      lookY: clamp(frame.lookY, -1, 1),
      buttons: frame.buttons >>> 0,
    };
    if (this.#commands.length >= this.capacity) this.#commands.shift();
    this.#commands.push(command);
    return command;
  }

  get length(): number { return this.#commands.length; }
  latest(): InputCommand | undefined { return this.#commands.at(-1); }
  find(currentTick: Tick): InputCommand | undefined { return this.#commands.find((command) => command.tick === currentTick); }
  since(sequence: number): InputCommand[] { return this.#commands.filter((command) => command.sequence > sequence); }
  consumeThrough(currentTick: Tick): InputCommand[] {
    const index = this.#commands.findLastIndex((command) => command.tick <= currentTick);
    if (index < 0) return [];
    return this.#commands.splice(0, index + 1);
  }
  clear(): void { this.#commands.length = 0; }
}

export interface InputBinding { readonly action: string; readonly code: string; readonly button?: InputButton; readonly scale?: number; }

export class InputMap {
  #bindings = new Map<string, InputBinding>();
  bind(binding: InputBinding): void {
    const action = binding.action.trim();
    if (!action) throw new TypeError('action is required');
    this.#bindings.set(action, { ...binding, action, scale: binding.scale ?? 1 });
  }
  unbind(action: string): boolean { return this.#bindings.delete(action); }
  resolve(code: string): InputBinding[] { return [...this.#bindings.values()].filter((binding) => binding.code === code).sort((a, b) => a.action.localeCompare(b.action)); }
  get(action: string): InputBinding | undefined { return this.#bindings.get(action); }
  actions(): string[] { return [...this.#bindings.keys()].sort(); }
}

export class InputAggregator {
  #moveX = 0; #moveZ = 0; #lookX = 0; #lookY = 0; #buttons = 0;
  setMove(x: number, z: number): void { this.#moveX = clamp(x, -1, 1); this.#moveZ = clamp(z, -1, 1); }
  addLook(x: number, y: number): void { this.#lookX = clamp(this.#lookX + x, -1, 1); this.#lookY = clamp(this.#lookY + y, -1, 1); }
  setButton(button: InputButton, down: boolean): void { this.#buttons = down ? this.#buttons | button : this.#buttons & ~button; }
  snapshot(currentTick: number): InputFrame {
    const result: InputFrame = { tick: tick(currentTick), moveX: this.#moveX, moveZ: this.#moveZ, lookX: this.#lookX, lookY: this.#lookY, buttons: this.#buttons >>> 0 };
    this.#lookX = 0; this.#lookY = 0;
    return result;
  }
}
