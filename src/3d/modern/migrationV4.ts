import {
  type OutcomeV4,
  okV4,
  failV4,
  createRuntimeErrorV4,
  type RuntimeSourceV4,
  type RuntimeId,
  type RuntimeSnapshotV4,
  type RuntimeHealthV4,
  type QualityTierV4,
} from './runtimeContractsV4';
import { RuntimeV4Facade } from './runtimeV4Facade';

export type MigrationSurfaceV4 = 'input' | 'movement' | 'camera' | 'world' | 'render' | 'audio' | 'assets' | 'save' | 'network' | 'telemetry';
export type MigrationStatusV4 = 'legacy' | 'shadow' | 'parity' | 'promoted' | 'blocked';

export interface MigrationEvidenceV4 {
  readonly surface: MigrationSurfaceV4;
  readonly legacyDigest: string;
  readonly modernDigest: string;
  readonly matched: boolean;
  readonly checkedAt: number;
  readonly source: RuntimeSourceV4;
}

export interface MigrationRecordV4 {
  readonly surface: MigrationSurfaceV4;
  readonly status: MigrationStatusV4;
  readonly evidence: readonly MigrationEvidenceV4[];
  readonly attempts: number;
}

export interface MigrationReportV4 {
  readonly runtime: RuntimeId;
  readonly promoted: number;
  readonly blocked: number;
  readonly parity: number;
  readonly records: readonly MigrationRecordV4[];
}

const surfaces: readonly MigrationSurfaceV4[] = ['input', 'movement', 'camera', 'world', 'render', 'audio', 'assets', 'save', 'network', 'telemetry'];
const digest = (value: unknown): string => {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export class MigrationRegistryV4 {
  readonly runtime: RuntimeId;
  #records = new Map<MigrationSurfaceV4, MigrationRecordV4>();

  constructor(runtime: RuntimeId) {
    this.runtime = runtime;
    for (const surface of surfaces) this.#records.set(surface, Object.freeze({ surface, status: 'legacy', evidence: Object.freeze([]), attempts: 0 }));
  }

  status(surface: MigrationSurfaceV4): MigrationStatusV4 {
    return this.#records.get(surface)!.status;
  }

  record(surface: MigrationSurfaceV4, legacy: unknown, modern: unknown, source: RuntimeSourceV4 = 'system', now = Date.now()): MigrationEvidenceV4 {
    const current = this.#records.get(surface)!;
    const legacyDigest = digest(legacy);
    const modernDigest = digest(modern);
    const evidence = Object.freeze({ surface, legacyDigest, modernDigest, matched: legacyDigest === modernDigest, checkedAt: now, source });
    const nextEvidence = Object.freeze([...current.evidence, evidence].slice(-32));
    const matchedCount = nextEvidence.filter((entry) => entry.matched).length;
    const status: MigrationStatusV4 = evidence.matched ? (matchedCount >= 1 ? 'parity' : 'shadow') : 'blocked';
    this.#records.set(surface, Object.freeze({ surface, status, evidence: nextEvidence, attempts: current.attempts + 1 }));
    return evidence;
  }

  promote(surface: MigrationSurfaceV4): OutcomeV4<boolean> {
    const record = this.#records.get(surface)!;
    if (!record.evidence.some((evidence) => evidence.matched)) return failV4(createRuntimeErrorV4('MIGRATION_PARITY_REQUIRED', `${surface} cannot be promoted without parity evidence`, false));
    if (record.status === 'blocked') return failV4(createRuntimeErrorV4('MIGRATION_BLOCKED', `${surface} is blocked`, false));
    this.#records.set(surface, Object.freeze({ ...record, status: 'promoted' }));
    return okV4(true);
  }

  block(surface: MigrationSurfaceV4): void {
    const record = this.#records.get(surface)!;
    this.#records.set(surface, Object.freeze({ ...record, status: 'blocked' }));
  }

  reset(surface?: MigrationSurfaceV4): void {
    if (surface) this.#records.set(surface, Object.freeze({ surface, status: 'legacy', evidence: Object.freeze([]), attempts: 0 }));
    else for (const entry of surfaces) this.reset(entry);
  }

  report(): MigrationReportV4 {
    const records = Object.freeze([...this.#records.values()]);
    return Object.freeze({ runtime: this.runtime, promoted: records.filter((entry) => entry.status === 'promoted').length, blocked: records.filter((entry) => entry.status === 'blocked').length, parity: records.filter((entry) => entry.status === 'parity').length, records });
  }
}

export interface ShadowRuntimeV4 {
  readonly facade: RuntimeV4Facade;
  readonly migration: MigrationRegistryV4;
  readonly compareHealth: (legacy: RuntimeHealthV4, modern: RuntimeHealthV4) => MigrationEvidenceV4;
}

export function createShadowRuntimeV4(facade: RuntimeV4Facade): ShadowRuntimeV4 {
  const migration = new MigrationRegistryV4(facade.id);
  return {
    facade,
    migration,
    compareHealth(legacy, modern) {
      return migration.record('telemetry', { score: Math.round(legacy.score), phase: legacy.phase }, { score: Math.round(modern.score), phase: modern.phase }, 'system');
    },
  };
}

export function migrationReadyV4(report: MigrationReportV4, required: readonly MigrationSurfaceV4[]): boolean {
  return required.every((surface) => report.records.find((record) => record.surface === surface)?.status === 'promoted');
}

export function snapshotProjectionV4(snapshot: RuntimeSnapshotV4): Readonly<Record<string, unknown>> {
  return Object.freeze({ version: snapshot.header.version, tick: Number(snapshot.header.tick), runtime: String(snapshot.header.runtime), state: snapshot.state });
}

export function migrationQualityFloorV4(quality: QualityTierV4): boolean {
  return quality !== 'minimal';
}
