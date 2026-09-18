import type { ContentHashV7, RuntimeHealthV7, RuntimeModeV7, TickV7 } from './types.ts';
import { hashV7 } from './types.ts';
import { checksumV7 } from './deterministic.ts';
import { RuntimeTelemetryV7 } from './observability.ts';

export interface RuntimeDiagnosticSnapshotV7 {
  readonly tick: TickV7;
  readonly mode: RuntimeModeV7;
  readonly phase: string;
  readonly health: RuntimeHealthV7;
  readonly entityCount: number;
  readonly spatialCells: number;
  readonly queuedTasks: number;
  readonly assetBytes: number;
  readonly networkState: string;
  readonly checksum: ContentHashV7;
}

export class RuntimeDiagnosticsV7 {
  #last: RuntimeDiagnosticSnapshotV7 | null = null;
  #history: RuntimeDiagnosticSnapshotV7[] = [];

  publish(snapshot: Omit<RuntimeDiagnosticSnapshotV7, 'checksum'>): RuntimeDiagnosticSnapshotV7 {
    const checksum = checksumV7(snapshot);
    const value = Object.freeze({ ...snapshot, checksum });
    this.#last = value;
    this.#history.push(value);
    while (this.#history.length > 120) this.#history.shift();
    return value;
  }

  latest(): RuntimeDiagnosticSnapshotV7 | null { return this.#last; }
  history(): readonly RuntimeDiagnosticSnapshotV7[] { return Object.freeze([...this.#history]); }

  digest(): number {
    let value = 2166136261;
    for (const item of this.#history) {
      value ^= Number(item.tick) ^ item.health.score ^ item.entityCount ^ item.spatialCells;
      value = Math.imul(value, 16777619) >>> 0;
    }
    return value >>> 0;
  }

  static fromTelemetry(telemetry: RuntimeTelemetryV7, tick: TickV7, mode: RuntimeModeV7): RuntimeHealthV7 {
    return telemetry.summarize(tick);
  }

  static checksum(snapshot: RuntimeDiagnosticSnapshotV7): ContentHashV7 {
    return hashV7(checksumV7(snapshot));
  }
}
