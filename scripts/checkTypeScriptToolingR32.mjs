import { readFile } from 'node:fs/promises';
import process from 'node:process';

const migratedScripts = [
  'checkCelestialVisualQa',
  'checkNorthTerrainVisualQa',
  'checkTexturePaletteLibrary',
  'checkRun330CastleTexturing',
  'checkRun327CreatureGait',
  'roadNetworkSafetyCheck',
  'checkCurrentLifecycleReinitShadow',
  'checkCurrentRuntimeIntegrationShadow',
];

const failures = [];
for (const name of migratedScripts) {
  const js = await readFile(`scripts/${name}.js`, 'utf8').catch(() => null);
  const ts = await readFile(`scripts/${name}.ts`, 'utf8').catch(() => null);
  if (!ts) {
    failures.push(`scripts/${name}.ts: missing TypeScript production owner`);
    continue;
  }
  if (!js) {
    failures.push(`scripts/${name}.js: compatibility launcher missing`);
    continue;
  }
  if (!js.includes(`./${name}.ts`)) failures.push(`scripts/${name}.js: launcher target missing`);
  if (!js.includes('--experimental-strip-types')) failures.push(`scripts/${name}.js: Node TypeScript runner flag missing`);
  if (js.includes('require(') || js.includes('__dirname')) failures.push(`scripts/${name}.js: legacy CommonJS implementation leaked into launcher`);
  if (!ts.includes('#!/usr/bin/env node')) failures.push(`scripts/${name}.ts: executable header missing`);
  if (!ts.includes('// @ts-nocheck')) failures.push(`scripts/${name}.ts: migration mode marker missing`);
  if (/\beval\s*\(|\bnew Function\s*\(/u.test(ts)) failures.push(`scripts/${name}.ts: unsafe dynamic code primitive detected`);
}

const workerTs = await readFile('service-worker.ts', 'utf8').catch(() => null);
const workerJs = await readFile('service-worker.js', 'utf8').catch(() => null);
if (!workerTs || !workerJs) failures.push('service-worker source/artifact pair missing');
if (workerTs && !workerTs.includes('Production TypeScript owner')) failures.push('service-worker.ts: production owner marker missing');

if (failures.length) {
  console.error(`R32 tooling/source gate failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  migratedToolingScripts: migratedScripts.length,
  policy: 'TS-production-source-with-legacy-JS-launcher',
  browserArtifact: 'service-worker.js generated from service-worker.ts',
}, null, 2));
