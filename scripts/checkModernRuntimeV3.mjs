#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const warnings = [];

const required = [
  'src/3d/modern/aiAuthority.ts',
  'src/3d/modern/animationAuthority.ts',
  'src/3d/modern/assetIntegrityV2.ts',
  'src/3d/modern/combatAuthority.ts',
  'src/3d/modern/healthScoringV2.ts',
  'src/3d/modern/interestManager.ts',
  'src/3d/modern/navigationRuntime.ts',
  'src/3d/modern/networkRuntimeV2.ts',
  'src/3d/modern/playerAuthority.ts',
  'src/3d/modern/questAuthorityV2.ts',
  'src/3d/modern/renderIntegrationV2.ts',
  'src/3d/modern/replayVerifierV2.ts',
  'src/3d/modern/rollbackControllerV2.ts',
  'src/3d/modern/runtimeBenchmarksV2.ts',
  'src/3d/modern/runtimeContractMatrixV2.ts',
  'src/3d/modern/runtimeDiagnosticsV2.ts',
  'src/3d/modern/runtimeIntegrationV2.ts',
  'src/3d/modern/runtimeOrchestratorV2.ts',
  'src/3d/modern/runtimePersistenceV2.ts',
  'src/3d/modern/runtimeSecurityV2.ts',
  'src/3d/modern/streamingCachePolicyV2.ts',
  'src/3d/modern/weatherRuntime.ts',
  'src/3d/modern/worldChunkRuntime.ts',
  'src/3d/modern/worldInvariantV2.ts',
  'src/3d/modern/worldSpatialIndex.ts',
  'src/3d/modern/entityComponentRuntimeV3.ts',
  'src/3d/modern/assetGraphV3.ts',
  'src/3d/modern/networkSessionV3.ts',
  'tests/modern/runtimePlatformV3.test.ts',
];

const sources = new Map();
for (const relativePath of required) {
  try {
    sources.set(relativePath, await readFile(join(root, relativePath), 'utf8'));
  } catch {
    failures.push(`missing required file: ${relativePath}`);
  }
}

const forbidden = [
  [/\bMath\.random\s*\(/, 'ambient randomness'],
  [/\bnew Function\s*\(/, 'dynamic code generation'],
  [/\beval\s*\(/, 'runtime evaluation'],
  [/\bsetInterval\s*\(/, 'unbounded timer ownership'],
];

for (const [path, source] of sources) {
  for (const [pattern, label] of forbidden) {
    if (pattern.test(source)) failures.push(`${path}: ${label} is forbidden on the modern runtime surface`);
  }
  if (/\bTODO\b|\bFIXME\b/.test(source)) warnings.push(`${path}: contains TODO/FIXME marker`);
  if (source.length > 28_000) warnings.push(`${path}: source exceeds 28KB review budget`);
}

const index = sources.get('src/3d/modern/entityComponentRuntimeV3.ts') ?? '';
const asset = sources.get('src/3d/modern/assetGraphV3.ts') ?? '';
const network = sources.get('src/3d/modern/networkSessionV3.ts') ?? '';

if (!/stableDigest/.test(index)) failures.push('V3 ECS must expose deterministic digest integration');
if (!/maxConcurrent|maxInFlightBytes|maxResidentBytes/.test(asset)) failures.push('V3 asset graph must enforce bounded resource budgets');
if (!/reconcile|interpolation|acknowledgeInput/.test(network)) failures.push('V3 network session must expose prediction/reconciliation boundaries');

const packageSource = await readFile(join(root, 'package.json'), 'utf8');
const packageJson = JSON.parse(packageSource);
if (packageJson.type !== 'module') failures.push('package.json must remain native ESM');
if (!packageJson.scripts?.['verify:modern:v3']) failures.push('package.json must expose verify:modern:v3');
if (!packageJson.scripts?.typecheck) failures.push('package.json must expose typecheck');

console.log(JSON.stringify({
  ok: failures.length === 0,
  checkedFiles: sources.size,
  warnings,
  failures,
}, null, 2));

if (failures.length > 0) process.exitCode = 1;
