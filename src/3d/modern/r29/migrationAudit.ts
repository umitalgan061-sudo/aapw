import { readFile } from 'node:fs/promises';

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

const isLegacy = (path: string): boolean =>
  path.endsWith('.legacy.js') || path.includes('/vendor/') || path.includes('/third_party/');

const isShim = (source: string): boolean =>
  source.includes('export * from') && source.includes('.ts') && source.length < 1200;

export async function auditR29JavaScriptOwnership(paths: readonly string[]): Promise<R29MigrationAudit> {
  const javascriptPaths = paths
    .filter((path) => path.startsWith('src/') && path.endsWith('.js'))
    .filter((path) => !isLegacy(path))
    .sort();

  const entries: R29MigrationEntry[] = [];
  for (const javascriptPath of javascriptPaths) {
    const typescriptPath = javascriptPath.replace(/\.js$/, '.ts');
    try {
      const source = await readFile(javascriptPath, 'utf8');
      if (isShim(source)) {
        entries.push(Object.freeze({
          javascriptPath,
          typescriptPath,
          status: 'shim',
          reason: 'JavaScript entrypoint delegates ownership to TypeScript.',
        }));
        continue;
      }
      try {
        await readFile(typescriptPath, 'utf8');
        entries.push(Object.freeze({
          javascriptPath,
          typescriptPath,
          status: 'typed',
          reason: 'TypeScript owner exists beside the compatibility entrypoint.',
        }));
      } catch {
        entries.push(Object.freeze({
          javascriptPath,
          typescriptPath: null,
          status: 'missing-owner',
          reason: 'Production JavaScript source has no TypeScript owner.',
        }));
      }
    } catch {
      entries.push(Object.freeze({
        javascriptPath,
        typescriptPath: null,
        status: 'missing-owner',
        reason: 'JavaScript source could not be read.',
      }));
    }
  }

  return Object.freeze({
    scanned: entries.length,
    typed: entries.filter((entry) => entry.status === 'typed').length,
    shims: entries.filter((entry) => entry.status === 'shim').length,
    legacy: entries.filter((entry) => entry.status === 'legacy').length,
    missingOwner: entries.filter((entry) => entry.status === 'missing-owner').length,
    entries: Object.freeze(entries),
  });
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
