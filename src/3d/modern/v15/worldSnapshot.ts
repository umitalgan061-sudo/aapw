import { checksumV15, stableStringifyV15, type ChunkRecordV15, type TickV15 } from "./types.ts";

export interface WorldSnapshotV15<T> {
  readonly magic: "AAPW-WORLD-V15";
  readonly version: 15;
  readonly tick: TickV15;
  readonly createdAt: number;
  readonly chunks: readonly ChunkRecordV15[];
  readonly state: T;
  readonly checksum: number;
}

export interface WorldSnapshotOptionsV15 {
  readonly maxBytes?: number;
  readonly now?: () => number;
}

export class WorldSnapshotCodecV15<T> {
  readonly #maxBytes: number;
  readonly #now: () => number;

  constructor(options: WorldSnapshotOptionsV15 = {}) {
    this.#maxBytes = Math.max(4_096, Math.floor(options.maxBytes ?? 4 * 1024 * 1024));
    this.#now = options.now ?? (() => Date.now());
  }

  encode(tick: TickV15, state: T, chunks: readonly ChunkRecordV15[]): WorldSnapshotV15<T> {
    const sortedChunks = [...chunks]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(chunk => Object.freeze({ ...chunk }));
    const base = {
      magic: "AAPW-WORLD-V15" as const,
      version: 15 as const,
      tick,
      createdAt: this.#now(),
      chunks: Object.freeze(sortedChunks),
      state,
    };
    const snapshot: WorldSnapshotV15<T> = Object.freeze({ ...base, checksum: checksumV15(base) });
    const serialized = stableStringifyV15(snapshot);
    if (new TextEncoder().encode(serialized).byteLength > this.#maxBytes) throw new RangeError("world snapshot exceeds configured size");
    return snapshot;
  }

  encodeText(tick: TickV15, state: T, chunks: readonly ChunkRecordV15[]): string {
    return stableStringifyV15(this.encode(tick, state, chunks));
  }

  decode(value: string | WorldSnapshotV15<T>): WorldSnapshotV15<T> {
    const parsed = typeof value === "string" ? JSON.parse(value) as WorldSnapshotV15<T> : value;
    validateWorldSnapshotV15(parsed, this.#maxBytes);
    return Object.freeze({
      ...parsed,
      chunks: Object.freeze([...parsed.chunks].sort((a, b) => a.id.localeCompare(b.id)).map(chunk => Object.freeze({ ...chunk }))),
    });
  }

  checksum(value: WorldSnapshotV15<T>): number {
    const { checksum, ...base } = value;
    return checksumV15(base);
  }

  same(left: WorldSnapshotV15<T>, right: WorldSnapshotV15<T>): boolean {
    return this.checksum(left) === this.checksum(right) && left.tick === right.tick;
  }

  diff(left: WorldSnapshotV15<T>, right: WorldSnapshotV15<T>): Readonly<{
    tickChanged: boolean;
    changedChunks: readonly string[];
    stateChanged: boolean;
    leftChecksum: number;
    rightChecksum: number;
  }> {
    const leftChunks = new Map(left.chunks.map(chunk => [String(chunk.id), checksumV15(chunk)]));
    const rightChunks = new Map(right.chunks.map(chunk => [String(chunk.id), checksumV15(chunk)]));
    const ids = [...new Set([...leftChunks.keys(), ...rightChunks.keys()])].sort();
    const changed = ids.filter(id => leftChunks.get(id) !== rightChunks.get(id));
    return Object.freeze({
      tickChanged: Number(left.tick) !== Number(right.tick),
      changedChunks: Object.freeze(changed),
      stateChanged: checksumV15(left.state) !== checksumV15(right.state),
      leftChecksum: left.checksum,
      rightChecksum: right.checksum,
    });
  }
}

function validateWorldSnapshotV15<T>(snapshot: WorldSnapshotV15<T>, maxBytes: number): void {
  if (snapshot.magic !== "AAPW-WORLD-V15" || snapshot.version !== 15) throw new Error("unsupported world snapshot");
  if (!Number.isInteger(Number(snapshot.tick)) || Number(snapshot.tick) < 0) throw new Error("invalid snapshot tick");
  if (!Array.isArray(snapshot.chunks)) throw new Error("invalid snapshot chunks");
  const { checksum, ...base } = snapshot;
  if (checksumV15(base) !== checksum) throw new Error("world snapshot checksum mismatch");
  if (new TextEncoder().encode(stableStringifyV15(snapshot)).byteLength > maxBytes) throw new RangeError("world snapshot too large");
}
