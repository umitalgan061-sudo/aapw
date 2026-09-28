/** Deterministic command journal for replay, rollback and debugging. */

export interface JournalCommand { tick: number; sequence: number; type: string; entityId: number; payload: unknown }
export interface JournalCheckpoint { tick: number; sequence: number; commandOffset: number; digest: number }
export interface JournalCursor { tick: number; sequence: number; offset: number }

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
}
function hash(text: string): number { let result = 2166136261 >>> 0; for (let i = 0; i < text.length; i += 1) { result ^= text.charCodeAt(i); result = Math.imul(result, 16777619) >>> 0; } return result >>> 0; }

export class RuntimeCommandJournalV3 {
  readonly capacity: number;
  #commands: JournalCommand[] = [];
  #checkpoints: JournalCheckpoint[] = [];
  #nextSequence = 1;

  constructor(capacity = 8192) { if (!Number.isInteger(capacity) || capacity < 32) throw new RangeError('journal capacity must be >= 32'); this.capacity = capacity; }

  append(command: Omit<JournalCommand, 'sequence'> & { sequence?: number }): JournalCommand {
    const sequence = command.sequence ?? this.#nextSequence++;
    if (sequence >= this.#nextSequence) this.#nextSequence = sequence + 1;
    if (this.#commands.length > 0) {
      const previous = this.#commands.at(-1)!;
      if (command.tick < previous.tick || (command.tick === previous.tick && sequence <= previous.sequence)) throw new Error('journal commands must be monotonically ordered');
    }
    const item = { ...command, sequence, payload: JSON.parse(stable(command.payload)) };
    this.#commands.push(item);
    while (this.#commands.length > this.capacity) this.#commands.shift();
    return { ...item };
  }

  checkpoint(tick: number): JournalCheckpoint {
    const sequence = this.#commands.at(-1)?.sequence ?? 0;
    const digest = hash(stable(this.#commands));
    const checkpoint = { tick, sequence, commandOffset: this.#commands.length, digest };
    this.#checkpoints.push(checkpoint);
    if (this.#checkpoints.length > 64) this.#checkpoints.shift();
    return { ...checkpoint };
  }

  cursorAt(tick: number, sequence = Number.MAX_SAFE_INTEGER): JournalCursor {
    let offset = 0;
    for (const command of this.#commands) {
      if (command.tick > tick || (command.tick === tick && command.sequence > sequence)) break;
      offset += 1;
    }
    return { tick, sequence, offset };
  }

  commandsFrom(cursor: JournalCursor): JournalCommand[] {
    return this.#commands.slice(cursor.offset).map((command) => ({ ...command }));
  }

  nearestCheckpoint(tick: number): JournalCheckpoint | undefined {
    return [...this.#checkpoints].reverse().find((checkpoint) => checkpoint.tick <= tick);
  }

  digest(): number { return hash(stable(this.#commands)); }
  size(): number { return this.#commands.length; }
  checkpoints(): readonly JournalCheckpoint[] { return this.#checkpoints.map((checkpoint) => ({ ...checkpoint })); }
  clear(): void { this.#commands.length = 0; this.#checkpoints.length = 0; this.#nextSequence = 1; }
}
