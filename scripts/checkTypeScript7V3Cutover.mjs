import { strict as assert } from 'node:assert';
import { readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const required = [
  'src/3d/modern/v3/runtimeContracts.ts',
  'src/3d/modern/v3/runtimeKernel.ts',
  'src/3d/modern/v3/legacyGameAdapter.ts',
  'src/3d/modern/v3/browserFrameSource.ts',
  'src/3d/modern/v3/runtimeApplication.ts',
  'src/3d/modern/v3/index.ts',
  'scripts/generateTypeScript7V3CutoverMatrix.mjs',
  '.github/workflows/typescript7-v3-cutover.yml',
  'docs/TYPESCRIPT_7_V3_CUTOVER.md',
];
for (const file of required) await access(file);

const contracts = await readFile('src/3d/modern/v3/runtimeContracts.ts', 'utf8');
assert.match(contracts, /export const V3_SCHEMA/);
assert.match(contracts, /export interface V3RuntimeController/);
assert.match(contracts, /export interface V3LegacyAdapter/);
assert.match(contracts, /export function normalizeV3Action/);
assert.doesNotMatch(contracts, /Math\.random\s*\(/);

const kernel = await readFile('src/3d/modern/v3/runtimeKernel.ts', 'utf8');
assert.match(kernel, /FixedStepClock/);
assert.match(kernel, /V3RuntimeKernel/);
assert.match(kernel, /maxCatchUpSteps/);
assert.match(kernel, /render\/frame/);
assert.doesNotMatch(kernel, /new Function\s*\(/);
assert.doesNotMatch(kernel, /eval\s*\(/);

const adapter = await readFile('src/3d/modern/v3/legacyGameAdapter.ts', 'utf8');
assert.match(adapter, /import\('\.\.\/\.\.\/game3d\.js'\)/);
assert.match(adapter, /LEGACY_GAME_INIT_MISSING/);
assert.match(adapter, /invoke\(operation/);
assert.doesNotMatch(adapter, /as any/);

const application = await readFile('src/3d/modern/v3/runtimeApplication.ts', 'utf8');
assert.match(application, /createV3Application/);
assert.match(application, /createV3RuntimeKernel/);
assert.match(application, /createBrowserFrameSource/);
assert.match(application, /createModernRuntime/);

const generator = await readFile('scripts/generateTypeScript7V3CutoverMatrix.mjs', 'utf8');
assert.match(generator, /const expected = 4096/);
assert.match(generator, /TYPESCRIPT7_V3_CUTOVER_CASES/);
assert.equal((generator.match(/\['/g) ?? []).length >= 6, true);

const workflow = await readFile('.github/workflows/typescript7-v3-cutover.yml', 'utf8');
assert.match(workflow, /typescript@7/);
assert.match(workflow, /4096/);
assert.match(workflow, /--experimental-strip-types/);
assert.match(workflow, /typecheck/);

const docs = await readFile('docs/TYPESCRIPT_7_V3_CUTOVER.md', 'utf8');
assert.match(docs, /V3/);
assert.match(docs, /legacy/i);
assert.match(docs, /4096/);

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
assert.equal(branch, 'agent/typescript7-v3-native-cutover-20260916');

console.log('TypeScript 7 V3 cutover acceptance passed.');
