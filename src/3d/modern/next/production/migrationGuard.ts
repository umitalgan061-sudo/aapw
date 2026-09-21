import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

export interface MigrationBoundary {
  readonly legacy: string;
  readonly modern: string;
  readonly owner: 'runtime' | 'render' | 'input' | 'world' | 'network' | 'assets' | 'ui';
  readonly status: 'shadow' | 'adapting' | 'promoted' | 'compatibility';
  readonly allowLegacyImport: boolean;
}

export interface MigrationGuardResult {
  readonly ok: boolean;
  readonly checked: number;
  readonly violations: readonly string[];
  readonly boundaries: readonly MigrationBoundary[];
}

const DEFAULT_BOUNDARIES: readonly MigrationBoundary[] = [
  { legacy: 'src/3d/config.js', modern: 'src/3d/config.ts', owner: 'runtime', status: 'compatibility', allowLegacyImport: true },
  { legacy: 'src/3d/eventBus.js', modern: 'src/3d/eventBus.ts', owner: 'runtime', status: 'compatibility', allowLegacyImport: true },
  { legacy: 'src/3d/state.js', modern: 'src/3d/state.ts', owner: 'runtime', status: 'compatibility', allowLegacyImport: true },
  { legacy: 'src/3d/sceneManager.js', modern: 'src/3d/sceneManager.ts', owner: 'render', status: 'compatibility', allowLegacyImport: true },
  { legacy: 'src/3d/game3d.js', modern: 'src/3d/modern/next/production/browserBridge.ts', owner: 'runtime', status: 'adapting', allowLegacyImport: true },
  { legacy: 'src/3d/input.js', modern: 'src/3d/modern/next/input.ts', owner: 'input', status: 'adapting', allowLegacyImport: true },
  { legacy: 'src/3d/assetLoader.js', modern: 'src/3d/modern/next/resourceCache.ts', owner: 'assets', status: 'adapting', allowLegacyImport: true },
  { legacy: 'src/3d/world/chunkManager.js', modern: 'src/3d/modern/next/runtime.ts', owner: 'world', status: 'adapting', allowLegacyImport: true },
];

export async function verifyMigrationBoundaries(root = process.cwd(), boundaries = DEFAULT_BOUNDARIES): Promise<MigrationGuardResult> {
  const violations: string[] = [];
  let checked = 0;

  for (const boundary of boundaries) {
    const legacyPath = resolve(root, boundary.legacy);
    const modernPath = resolve(root, boundary.modern);
    const [legacyExists, modernExists] = await Promise.all([exists(legacyPath), exists(modernPath)]);
    checked += 2;
    if (!modernExists) {
      violations.push(`missing modern owner: ${boundary.modern}`);
      continue;
    }
    if (!legacyExists && boundary.status !== 'promoted') {
      violations.push(`legacy compatibility boundary disappeared unexpectedly: ${boundary.legacy}`);
    }
    if (boundary.status === 'promoted' && boundary.allowLegacyImport) {
      violations.push(`promoted boundary still allows legacy imports: ${boundary.legacy}`);
    }
  }

  const packagePath = resolve(root, 'package.json');
  if (await exists(packagePath)) {
    const packageText = await fs.readFile(packagePath, 'utf8');
    checked += 1;
    if (!packageText.includes('"type": "module"')) violations.push('package must remain native ESM');
    if (!packageText.includes('"typescript"')) violations.push('TypeScript dependency must remain explicit');
    if (!packageText.includes('"typecheck"')) violations.push('typecheck script missing');
  }

  return { ok: violations.length === 0, checked, violations, boundaries };
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export function renderMigrationReport(result: MigrationGuardResult): string {
  const lines = [
    `AAPW migration guard: ${result.ok ? 'PASS' : 'FAIL'}`,
    `Checked paths: ${result.checked}`,
    `Boundaries: ${result.boundaries.length}`,
  ];
  if (result.violations.length) {
    lines.push('Violations:');
    for (const violation of result.violations) lines.push(`- ${violation}`);
  }
  return lines.join('\\n');
}

if (process.argv[1] && process.argv[1].endsWith('migrationGuard.ts')) {
  const result = await verifyMigrationBoundaries();
  process.stdout.write(renderMigrationReport(result) + '\\n');
  if (!result.ok) process.exitCode = 1;
}
