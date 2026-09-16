/** Bounded input command buffer for keyboard, touch and gamepad adapters. */

export type InputAction = 'move' | 'look' | 'jump' | 'sprint' | 'dodge' | 'attack' | 'block' | 'interact';
export interface InputCommandV3 { tick: number; sequence: number; action: InputAction; valueX: number; valueY: number; pressed: boolean }
export interface InputBufferStats { size: number; dropped: number; firstTick: number | null; lastTick: number | null }

export class InputCommandBufferV3 {
  readonly capacity: number;
  #items: InputCommandV3[] = [];
  #dropped = 0;

  constructor(capacity = 128) { if (!Number.isInteger(capacity) || capacity < 4) throw new RangeError('capacity must be >= 4'); this.capacity = capacity; }

  push(command: InputCommandV3): boolean {
    if (!Number.isInteger(command.tick) || command.tick < 0) throw new RangeError('invalid input tick');
    if (!Number.isInteger(command.sequence) || command.sequence <= 0) throw new RangeError('invalid input sequence');
    const normalized = { ...command, valueX: Math.max(-1, Math.min(1, command.valueX)), valueY: Math.max(-1, Math.min(1, command.valueY)) };
    const duplicate = this.#items.some((item) => item.sequence === normalized.sequence);
    if (duplicate) return false;
    this.#items.push(normalized);
    this.#items.sort((a, b) => a.tick - b.tick || a.sequence - b.sequence);
    while (this.#items.length > this.capacity) { this.#items.shift(); this.#dropped += 1; }
    return true;
  }

  drainThrough(tick: number): InputCommandV3[] {
    const ready = this.#items.filter((item) => item.tick <= tick);
    this.#items = this.#items.filter((item) => item.tick > tick);
    return ready;
  }

  peek(tick: number): InputCommandV3 | undefined { return this.#items.find((item) => item.tick === tick); }
  clear(): void { this.#items.length = 0; }
  stats(): InputBufferStats { return { size: this.#items.length, dropped: this.#dropped, firstTick: this.#items[0]?.tick ?? null, lastTick: this.#items.at(-1)?.tick ?? null }; }
}
