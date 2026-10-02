
import { readFile, readdir } from 'node:fs/promises';
import { relative } from 'node:path';

export interface OwnershipReport {
  readonly ok: boolean;
  readonly scannedJavaScript: number;
  readonly compatibilityShims: number;
  readonly legacyJavaScript: number;
  readonly vendoredJavaScript: number;
  readonly generatedArtifacts: number;
  readonly missingOwners: readonly string[];
  readonly invalidShims: readonly string[];
  readonly unownedMjs: readonly string[];
}

const COMPATIBILITY_MARKER = 'TypeScript ownership compatibility boundary.';

export async function scanTypeScriptOwnership(rootDirectory = new URL('../../../../', import.meta.url)): Promise<OwnershipReport> {
  const root = rootDirectory instanceof URL ? rootDirectory : new URL(String(rootDirectory));
  const sourceRoot = new URL('src/', root);
  const missingOwners: string[] = [];
  const invalidShims: string[] = [];
  const unownedMjs: string[] = [];
  let scannedJavaScript = 0;
  let compatibilityShims = 0;
  let legacyJavaScript = 0;
  let vendoredJavaScript = 0;
  let generatedArtifacts = 0;

  const files = await walk(sourceRoot);
  for (const file of files) {
    const relativePath = relative(sourceRoot.pathname, file.pathname).replaceAll('\\\\', '/');
    if (relativePath.includes('/vendor/')) {
      if (relativePath.endsWith('.js')) vendoredJavaScript += 1;
      continue;
    }
    if (relativePath.startsWith('3d/editor/')) {
      generatedArtifacts += 1;
      continue;
    }
    if (relativePath.endsWith('.legacy.js')) {
      legacyJavaScript += 1;
      continue;
    }
    if (relativePath.endsWith('.mjs')) {
      const typedPath = file.pathname.slice(0, -4) + '.ts';
      const owner = await readFile(typedPath, 'utf8').catch(() => null);
      if (!owner) unownedMjs.push(relativePath);
      continue;
    }
    if (!relativePath.endsWith('.js')) continue;

    scannedJavaScript += 1;
    const source = await readFile(file, 'utf8');
    const typedPath = file.pathname.slice(0, -3) + '.ts';
    const owner = await readFile(typedPath, 'utf8').catch(() => null);
    if (!owner) missingOwners.push(relativePath);

    const shim = source.includes(COMPATIBILITY_MARKER);
    const typedImport = /\bimport\s+\*\s+as\s+__typed\s+from\s+['"]\.\/[^'"]+\.ts['"]/.test(source);
    const reExport = /export\s+\*\s+from\s+['"]\.\/[^'"]+\.ts['"]/.test(source) ||
      /export\s+\{[^}]+\}\s+from\s+['"]\.\/[^'"]+\.ts['"]/.test(source);
    if (!shim || !typedImport || !reExport) invalidShims.push(relativePath);
    else compatibilityShims += 1;
  }

  const script = await readFile(new URL('script.js', root), 'utf8').catch(() => '');
  const serviceWorker = await readFile(new URL('service-worker.js', root), 'utf8').catch(() => '');
  const scriptOwner = await readFile(new URL('script.ts', root), 'utf8').catch(() => null);
  const serviceOwner = await readFile(new URL('service-worker.ts', root), 'utf8').catch(() => null);

  if (!scriptOwner || !script.includes('./script.ts')) missingOwners.push('script.js');
  if (!serviceOwner || !serviceWorker.includes('generated-from: service-worker.ts')) missingOwners.push('service-worker.js');

  return Object.freeze({
    ok: missingOwners.length === 0 && invalidShims.length === 0 && unownedMjs.length === 0,
    scannedJavaScript,
    compatibilityShims,
    legacyJavaScript,
    vendoredJavaScript,
    generatedArtifacts,
    missingOwners: Object.freeze([...new Set(missingOwners)].sort()),
    invalidShims: Object.freeze([...new Set(invalidShims)].sort()),
    unownedMjs: Object.freeze([...new Set(unownedMjs)].sort()),
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
