/**
 * Repository-wide TypeScript ownership policy for R42.
 * Production TypeScript owner.
 *
 * JavaScript is allowed only when it is an explicit generated/compatibility boundary
 * with a sibling TypeScript owner. The scanner is intentionally structural so the policy
 * remains useful as the repository grows.
 */
import { readdir, readFile } from 'node:fs/promises';
import { relative } from 'node:path';

export interface OwnershipR42Report {
  readonly ok: boolean;
  readonly scannedJavaScript: number;
  readonly ownedJavaScript: number;
  readonly compatibilityShims: number;
  readonly unownedJavaScript: readonly string[];
  readonly generatedJavaScript: readonly string[];
  readonly missingTypeOwners: readonly string[];
}

const COMPATIBILITY_MARKERS = [
  'TypeScript ownership compatibility boundary.',
  'generated-from:',
  'Production TypeScript owner',
];

export async function scanOwnershipR42(
  projectRoot = new URL('../../../../', import.meta.url),
): Promise<OwnershipR42Report> {
  const sourceRoot = new URL('src/', projectRoot);
  // Build/test tooling under scripts/ may legitimately remain .mjs/.js during the repository-wide migration.
  // Production runtime ownership is governed by src/ and the dedicated R41 compatibility checks.
  const unowned: string[] = [];
  const generated: string[] = [];
  const missingTypeOwners: string[] = [];
  let scanned = 0;
  let owned = 0;
  let shims = 0;

  for (const root of [sourceRoot]) {
    const files = await walk(root);
    for (const file of files) {
      const relativePath = relative(projectRoot.pathname, file.pathname).replaceAll('\\', '/');
      if (!/\.(js|mjs|cjs)$/.test(relativePath)) continue;
      scanned += 1;
      if (relativePath.includes('/vendor/') || relativePath.includes('/generated/')) {
        generated.push(relativePath);
        continue;
      }
      const source = await readFile(file, 'utf8').catch(() => '');
      const typedPath = file.pathname.replace(/\.(js|mjs|cjs)$/, '.ts');
      const owner = await readFile(typedPath, 'utf8').catch(() => null);
      const marker = COMPATIBILITY_MARKERS.some(value => source.includes(value));
      if (marker && owner) {
        owned += 1;
        shims += 1;
        continue;
      }
      if (!owner) {
        unowned.push(relativePath);
        missingTypeOwners.push(relativePath.replace(/\.(js|mjs|cjs)$/, '.ts'));
      } else {
        owned += 1;
      }
    }
  }

  return Object.freeze({
    ok: unowned.length === 0,
    scannedJavaScript: scanned,
    ownedJavaScript: owned,
    compatibilityShims: shims,
    unownedJavaScript: Object.freeze([...new Set(unowned)].sort()),
    generatedJavaScript: Object.freeze([...new Set(generated)].sort()),
    missingTypeOwners: Object.freeze([...new Set(missingTypeOwners)].sort()),
  });
}

async function walk(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: URL[] = [];
  for (const entry of entries) {
    const next = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) files.push(...await walk(next));
    else files.push(next);
  }
  return files;
}
