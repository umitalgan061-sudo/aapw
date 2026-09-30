export type R29MigrationStatus = 'typed' | 'shim' | 'legacy' | 'missing-owner';

export interface R29MigrationEntry {
  readonly javascriptPath: string;
  readonly typescriptPath: string | null;
  readonly status: R29MigrationStatus;
  readonly reason: string;
}

export interface R29MigrationAudit {
  readonly scanned: number;
  readonly typed: number;
  readonly shims: number;
  readonly legacy: number;
  readonly missingOwner: number;
  readonly entries: readonly R29MigrationEntry[];
}

export interface R29MigrationReader {
  readonly readText: (path: string) => Promise<string>;
}

export interface R29MigrationSource {
  readonly javascriptPath: string;
  readonly javascriptSource: string;
  readonly typescriptExists: boolean;
}

const isLegacy = (path: string): boolean =>
  path.endsWith('.legacy.js') || path.includes('/vendor/') || path.includes('/third_party/');

const isShim = (source: string): boolean =>
  source.includes('export * from') && source.includes('.ts') && source.length < 1200;

export function evaluateR29MigrationSources(sources: readonly R29MigrationSource[]): R29MigrationAudit {
  const entries: R29MigrationEntry[] = sources
    .filter((item) => item.javascriptPath.startsWith('src/') && item.javascriptPath.endsWith('.js'))
    .filter((item) => !isLegacy(item.javascriptPath))
    .map((item) => {
      const typescriptPath = item.javascriptPath.replace(/\.js$/, '.ts');
      if (isShim(item.javascriptSource)) {
        return Object.freeze({
          javascriptPath: item.javascriptPath,
          typescriptPath,
          status: 'shim' as const,
          reason: 'JavaScript entrypoint delegates ownership to TypeScript.',
        });
      }
      if (item.typescriptExists) {
        return Object.freeze({
          javascriptPath: item.javascriptPath,
          typescriptPath,
          status: 'typed' as const,
          reason: 'TypeScript owner exists beside the compatibility entrypoint.',
        });
      }
      return Object.freeze({
        javascriptPath: item.javascriptPath,
        typescriptPath: null,
        status: 'missing-owner' as const,
        reason: 'Production JavaScript source has no TypeScript owner.',
      });
    })
    .sort((a, b) => a.javascriptPath.localeCompare(b.javascriptPath));

  return Object.freeze({
    scanned: entries.length,
    typed: entries.filter((entry) => entry.status === 'typed').length,
    shims: entries.filter((entry) => entry.status === 'shim').length,
    legacy: entries.filter((entry) => entry.status === 'legacy').length,
    missingOwner: entries.filter((entry) => entry.status === 'missing-owner').length,
    entries: Object.freeze(entries),
  });
}

export async function auditR29JavaScriptOwnership(
  paths: readonly string[],
  reader: R29MigrationReader,
): Promise<R29MigrationAudit> {
  const sources: R29MigrationSource[] = [];
  const javascriptPaths = paths
    .filter((path) => path.startsWith('src/') && path.endsWith('.js'))
    .filter((path) => !isLegacy(path))
    .sort();

  for (const javascriptPath of javascriptPaths) {
    const javascriptSource = await reader.readText(javascriptPath).catch(() => '');
    const typescriptPath = javascriptPath.replace(/\.js$/, '.ts');
    const typescriptExists = await reader.readText(typescriptPath).then(() => true).catch(() => false);
    sources.push({ javascriptPath, javascriptSource, typescriptExists });
  }
  return evaluateR29MigrationSources(sources);
}

export function assertR29MigrationReady(audit: R29MigrationAudit): void {
  if (audit.missingOwner > 0) {
    const paths = audit.entries
      .filter((entry) => entry.status === 'missing-owner')
      .map((entry) => entry.javascriptPath)
      .join('|');
    throw new Error('R29_MIGRATION_OWNER_GAP:' + paths);
  }
}

export function summarizeR29Migration(audit: R29MigrationAudit): string {
  return [
    'scanned=' + audit.scanned,
    'typed=' + audit.typed,
    'shims=' + audit.shims,
    'missingOwner=' + audit.missingOwner,
  ].join(' ');
}
