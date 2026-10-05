import { stableDigest, type RuntimeCommand, type WorkPriority } from './contracts.ts';

const ORDER: Record<RuntimeCommand['type'], number> = {
  spawn: 0,
  resume: 1,
  custom: 2,
  'set-quality': 3,
  pause: 4,
  despawn: 5,
};

const PRIORITY: Record<WorkPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
};

export interface BufferedCommand {
  readonly sequence: number;
  readonly priority: WorkPriority;
  readonly command: RuntimeCommand;
  readonly digest: string;
}

export class CommandBuffer {
  readonly capacity: number;
  #sequence = 0;
  #items: BufferedCommand[] = [];

  constructor(capacity = 256) {
    this.capacity = Math.max(8, Math.trunc(capacity));
  }

  push(command: RuntimeCommand, priority: WorkPriority = 'normal'): boolean {
    if (this.#items.length >= this.capacity) return false;
    const item: BufferedCommand = Object.freeze({
      sequence: this.#sequence++,
      priority,
      command,
      digest: stableDigest(command),
    });
    this.#items.push(item);
    return true;
  }

  drain(): readonly BufferedCommand[] {
    const result = [...this.#items].sort((a, b) => {
      const priority = PRIORITY[a.priority] - PRIORITY[b.priority];
      if (priority !== 0) return priority;
      const command = ORDER[a.command.type] - ORDER[b.command.type];
      if (command !== 0) return command;
      return a.sequence - b.sequence;
    });
    this.#items = [];
    return Object.freeze(result);
  }

  peek(limit = this.capacity): readonly BufferedCommand[] {
    return Object.freeze([...this.#items].slice(0, Math.max(0, limit)));
  }

  size(): number {
    return this.#items.length;
  }

  isEmpty(): boolean {
    return this.#items.length === 0;
  }

  clear(): void {
    this.#items = [];
  }

  digest(): string {
    return stableDigest(this.#items.map((item) => ({
      sequence: item.sequence,
      priority: item.priority,
      digest: item.digest,
    })));
  }
}
