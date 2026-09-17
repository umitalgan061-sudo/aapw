export const LEGACY_EXTENSION = '.js' as const;
export const MODERN_EXTENSION = '.ts' as const;

export type MigrationPhase = 'inventory' | 'facade' | 'cutover' | 'retire';
export type MigrationPriority = 'critical' | 'high' | 'normal' | 'low';

export interface SourceRecord {
  readonly path: string;
  readonly phase: MigrationPhase;
  readonly priority: MigrationPriority;
  readonly importsLegacyRuntime: boolean;
  readonly browserEntrypoint: boolean;
}

export interface MigrationDecision {
  readonly path: string;
  readonly allowed: boolean;
  readonly reason: string;
  readonly nextPhase: MigrationPhase;
}

const BROWSER_ENTRYPOINTS = new Set([
  'src/3d/game3d.js',
  'src/3d/sceneManager.js',
  'src/3d/editor/worldEditor.js',
]);

const CRITICAL_PREFIXES = [
  'src/3d/gameplay/',
  'src/3d/world/',
  'src/3d/rendering/',
  'src/3d/network/',
  'src/3d/core/',
];

export function normalizeSourcePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function isLegacySource(path: string): boolean {
  return normalizeSourcePath(path).endsWith(LEGACY_EXTENSION);
}

export function isBrowserEntrypoint(path: string): boolean {
  return BROWSER_ENTRYPOINTS.has(normalizeSourcePath(path));
}

export function migrationPriority(path: string): MigrationPriority {
  const normalized = normalizeSourcePath(path);
  if (isBrowserEntrypoint(normalized)) return 'critical';
  if (CRITICAL_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return 'high';
  if (normalized.startsWith('scripts/')) return 'low';
  return 'normal';
}

export function classifySource(path: string, importsLegacyRuntime = false): SourceRecord {
  const normalized = normalizeSourcePath(path);
  const legacy = isLegacySource(normalized);
  return {
    path: normalized,
    phase: legacy ? 'inventory' : 'cutover',
    priority: migrationPriority(normalized),
    importsLegacyRuntime,
    browserEntrypoint: isBrowserEntrypoint(normalized),
  };
}

export function evaluateMigration(record: SourceRecord): MigrationDecision {
  if (!isLegacySource(record.path)) {
    return {
      path: record.path,
      allowed: true,
      reason: 'Already represented by the modern TypeScript surface.',
      nextPhase: 'retire',
    };
  }
  if (record.browserEntrypoint && record.importsLegacyRuntime) {
    return {
      path: record.path,
      allowed: false,
      reason: 'Browser entrypoint still depends on a legacy runtime; introduce the typed facade before cutover.',
      nextPhase: 'facade',
    };
  }
  if (record.importsLegacyRuntime) {
    return {
      path: record.path,
      allowed: false,
      reason: 'Legacy dependency must be inverted behind a typed port.',
      nextPhase: 'facade',
    };
  }
  return {
    path: record.path,
    allowed: false,
    reason: 'Legacy source requires a TypeScript replacement and regression coverage before removal.',
    nextPhase: 'cutover',
  };
}

export function partitionSources(records: readonly SourceRecord[]): {
  readonly ready: readonly SourceRecord[];
  readonly blocked: readonly SourceRecord[];
  readonly critical: readonly SourceRecord[];
} {
  const decisions = records.map((record) => ({ record, decision: evaluateMigration(record) }));
  return {
    ready: decisions.filter(({ decision }) => decision.allowed).map(({ record }) => record),
    blocked: decisions.filter(({ decision }) => !decision.allowed).map(({ record }) => record),
    critical: decisions
      .filter(({ record }) => record.priority === 'critical')
      .map(({ record }) => record),
  };
}
