/**
 * Explicit compatibility registry for remaining JavaScript entrypoints.
 * Production TypeScript owner.
 *
 * The goal is not to pretend legacy code disappeared. The goal is to make every
 * remaining JavaScript boundary enumerable, typed, reviewable and one-directional.
 */
import { deepFreeze, hashValue } from './types.ts';

export type CompatibilityState = 'validated' | 'migration-ready' | 'legacy-only' | 'blocked';
export type CompatibilityRisk = 'low' | 'medium' | 'high' | 'critical';

export interface CompatibilityBoundary {
  readonly legacyPath: string;
  readonly typedOwner: string;
  readonly state: CompatibilityState;
  readonly risk: CompatibilityRisk;
  readonly reason: string;
  readonly publicExports: readonly string[];
  readonly deprecated: boolean;
}

export interface CompatibilityAudit {
  readonly ok: boolean;
  readonly boundaries: readonly CompatibilityBoundary[];
  readonly blocked: readonly CompatibilityBoundary[];
  readonly unowned: readonly string[];
  readonly digest: number;
}

const RISK_WEIGHT: Record<CompatibilityRisk, number> = {
  low: 1,
  medium: 2,
  high: 4,
  critical: 8,
};

export class CompatibilityRegistryR42 {
  #entries = new Map<string, CompatibilityBoundary>();

  register(boundary: CompatibilityBoundary): void {
    const legacyPath = normalizePath(boundary.legacyPath);
    const typedOwner = normalizePath(boundary.typedOwner);
    if (!legacyPath || !typedOwner) throw new Error('R42 compatibility paths must be non-empty.');
    if (this.#entries.has(legacyPath)) throw new Error('R42 compatibility boundary already exists: ' + legacyPath);
    this.#entries.set(legacyPath, deepFreeze({
      ...boundary,
      legacyPath,
      typedOwner,
      publicExports: Object.freeze([...boundary.publicExports].map(value => value.slice(0, 160)).sort()),
    }));
  }

  upsert(boundary: CompatibilityBoundary): void {
    const legacyPath = normalizePath(boundary.legacyPath);
    const typedOwner = normalizePath(boundary.typedOwner);
    this.#entries.set(legacyPath, deepFreeze({
      ...boundary,
      legacyPath,
      typedOwner,
      publicExports: Object.freeze([...boundary.publicExports].sort()),
    }));
  }

  get(legacyPath: string): CompatibilityBoundary | null {
    return this.#entries.get(normalizePath(legacyPath)) ?? null;
  }

  all(): readonly CompatibilityBoundary[] {
    return Object.freeze([...this.#entries.values()].sort(compareBoundaries));
  }

  audit(requiredLegacyPaths: readonly string[] = []): CompatibilityAudit {
    const boundaries = this.all();
    const byLegacy = new Map(boundaries.map(value => [value.legacyPath, value]));
    const unowned = requiredLegacyPaths
      .map(normalizePath)
      .filter(path => path.length > 0 && !byLegacy.has(path))
      .sort();
    const blocked = boundaries.filter(value => value.state === 'blocked');
    const highRiskUntyped = boundaries.filter(value =>
      RISK_WEIGHT[value.risk] >= RISK_WEIGHT.high && value.state !== 'validated',
    );
    return Object.freeze({
      ok: blocked.length === 0 && unowned.length === 0 && highRiskUntyped.length === 0,
      boundaries,
      blocked: Object.freeze(blocked),
      unowned: Object.freeze(unowned),
      digest: hashValue(boundaries),
    });
  }

  readyForRemoval(legacyPath: string): boolean {
    const entry = this.get(legacyPath);
    return Boolean(entry && entry.state === 'migration-ready' && entry.deprecated);
  }

  markMigrated(legacyPath: string): boolean {
    const key = normalizePath(legacyPath);
    const current = this.#entries.get(key);
    if (!current) return false;
    this.#entries.set(key, deepFreeze({ ...current, state: 'migration-ready', deprecated: true }));
    return true;
  }

  remove(legacyPath: string): boolean {
    if (!this.readyForRemoval(legacyPath)) return false;
    return this.#entries.delete(normalizePath(legacyPath));
  }

  clear(): void {
    this.#entries.clear();
  }
}

export function createDefaultCompatibilityRegistryR42(): CompatibilityRegistryR42 {
  const registry = new CompatibilityRegistryR42();
  const defaults: readonly CompatibilityBoundary[] = [
    {
      legacyPath: 'src/3d/game3d.js',
      typedOwner: 'src/3d/strict/r42/runtime.ts',
      state: 'validated',
      risk: 'critical',
      reason: 'Browser entrypoint remains a compatibility surface while typed runtime owns state transitions.',
      publicExports: ['boot', 'dispose'],
      deprecated: false,
    },
    {
      legacyPath: 'src/3d/sceneManager.js',
      typedOwner: 'src/3d/strict/r42/browserBridge.ts',
      state: 'validated',
      risk: 'high',
      reason: 'Three.js scene setup is kept at a presentation adapter boundary.',
      publicExports: ['createScene'],
      deprecated: false,
    },
    {
      legacyPath: 'service-worker.js',
      typedOwner: 'service-worker.ts',
      state: 'validated',
      risk: 'high',
      reason: 'Browser service worker output is generated from typed source.',
      publicExports: ['install', 'activate', 'fetch'],
      deprecated: false,
    },
  ];
  for (const boundary of defaults) registry.register(boundary);
  return registry;
}

function normalizePath(value: string): string {
  return String(value).replaceAll('\\', '/').replace(/^\.\//, '').trim();
}

function compareBoundaries(a: CompatibilityBoundary, b: CompatibilityBoundary): number {
  return (
    RISK_WEIGHT[b.risk] - RISK_WEIGHT[a.risk]
    || a.legacyPath.localeCompare(b.legacyPath)
  );
}
