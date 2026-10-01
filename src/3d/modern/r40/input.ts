import type { CommandId, EntityId, RuntimeCommand, Tick, Vec3 } from './types';
import { commandId } from './types';
import { clamp, quantize, hashJson } from './deterministic';

export interface RawInputState {
  readonly axes: readonly number[];
  readonly buttons: readonly boolean[];
  readonly pointer?: { readonly x: number; readonly y: number; readonly primary: boolean };
  readonly wheel?: number;
}
export interface InputFrame {
  readonly move: Vec3;
  readonly look: Vec3;
  readonly jump: boolean;
  readonly sprint: boolean;
  readonly interact: boolean;
  readonly menu: boolean;
}
export interface InputLimits {
  readonly maxCommandsPerTick: number;
  readonly axisQuantization: number;
  readonly queueSize: number;
}

export class InputCommandBuffer {
  readonly limits: InputLimits;
  #queue: RuntimeCommand[] = [];
  #sequence = 0;
  constructor(limits: Partial<InputLimits> = {}) { this.limits = Object.freeze({ maxCommandsPerTick: 32, axisQuantization: 1 / 256, queueSize: 512, ...limits }); }

  sample(raw: RawInputState, tick: Tick, actor: EntityId): InputFrame {
    const axis = (index: number) => clamp(quantize(raw.axes[index] ?? 0, this.limits.axisQuantization), -1, 1);
    return Object.freeze({
      move: Object.freeze({ x: axis(0), y: 0, z: axis(1) }),
      look: Object.freeze({ x: axis(2), y: axis(3), z: 0 }),
      jump: Boolean(raw.buttons[0]),
      sprint: Boolean(raw.buttons[1]),
      interact: Boolean(raw.buttons[2]),
      menu: Boolean(raw.buttons[3]),
    });
  }

  push(type: string, payload: Readonly<Record<string, unknown>>, tick: Tick, actor: EntityId | null = null, predictionKey: string | null = null): RuntimeCommand | null {
    if (!/^[A-Za-z0-9_.:-]{1,96}$/.test(type) || this.#queue.length >= this.limits.queueSize) return null;
    const command: RuntimeCommand = Object.freeze({ id: commandId('input:' + String(++this.#sequence)), tick, actor, type, payload: Object.freeze({ ...payload }), sequence: this.#sequence, predictionKey });
    const sameTick = this.#queue.reduce((count, item) => count + (Number(item.tick) === Number(tick) ? 1 : 0), 0);
    if (sameTick >= this.limits.maxCommandsPerTick) return null;
    this.#queue.push(command); return command;
  }

  drain(tick: Tick): readonly RuntimeCommand[] {
    const selected = this.#queue.filter((command) => Number(command.tick) <= Number(tick)).sort((a, b) => a.sequence - b.sequence);
    this.#queue = this.#queue.filter((command) => Number(command.tick) > Number(tick));
    return Object.freeze(selected);
  }
  pending(): number { return this.#queue.length; }
  clear(): void { this.#queue.length = 0; }
  digest(): string { return hashJson(this.#queue); }
}

export function normalizePointer(x: number, y: number): { readonly x: number; readonly y: number } {
  return Object.freeze({ x: clamp(quantize(x, 1 / 1024), -1, 1), y: clamp(quantize(y, 1 / 1024), -1, 1) });
}
export function commandIdentity(command: RuntimeCommand): CommandId { return command.id; }
