import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';

const REQUIRED = [
  'src/3d/modern/runtimeTopologyV18.ts',
  'src/3d/modern/inputPipelineV18.ts',
  'src/3d/modern/assetLifecycleV18.ts',
  'src/3d/modern/worldLifecycleV18.ts',
  'src/3d/modern/renderPolicyV18.ts',
  'src/3d/modern/persistenceEnvelopeV18.ts',
  'src/3d/modern/runtimeApplicationV18.ts',
  'src/3d/modern/runtimeBrowserBridgeV18.ts',
  'src/3d/modern/runtimeHealthV18.ts',
  'tests/modern/runtimeApplicationV18.test.ts',
];

const INDEX_EXPECTATIONS = [
  'runtimeTopologyV18',
  'inputPipelineV18',
  'assetLifecycleV18',
  'worldLifecycleV18',
  'renderPolicyV18',
  'persistenceEnvelopeV18',
  'runtimeApplicationV18',
  'runtimeBrowserBridgeV18',
  'runtimeHealthV18',
];

const failures = [];

function record(ok, message) {
  if (!ok) failures.push(message);
}

async function read(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    failures.push(`${path}: missing or unreadable`);
    return '';
  }
}

for (const path of REQUIRED) {
  try {
    await access(path);
  } catch {
    failures.push(`${path}: missing`);
  }
}

const sources = await Promise.all(REQUIRED.map(read));
for (let index = 0; index < REQUIRED.length; index += 1) {
  const path = REQUIRED[index];
  const source = sources[index];
  record(!source.includes('@ts-nocheck'), `${path}: @ts-nocheck forbidden`);
  record(!source.includes('@ts-ignore'), `${path}: @ts-ignore forbidden`);
  record(!source.includes('eval('), `${path}: eval forbidden`);
  record(!source.includes('new Function('), `${path}: new Function forbidden`);
}

const indexSource = await read('src/3d/modern/index.ts');
for (const name of INDEX_EXPECTATIONS) {
  record(indexSource.includes(`./${name}`), `modern barrel missing ${name}`);
}

const packageSource = await read('package.json');
record(packageSource.includes('typescript'), 'package.json: TypeScript dependency missing');
record(packageSource.includes('typecheck'), 'package.json: typecheck script missing');

const tsconfig = await read('tsconfig.json');
record(tsconfig.includes('"strict": true'), 'tsconfig.json: strict mode missing');
record(tsconfig.includes('"noUncheckedIndexedAccess": true'), 'tsconfig.json: unchecked indexed access guard missing');
record(tsconfig.includes('"exactOptionalPropertyTypes": true'), 'tsconfig.json: exact optional property guard missing');

if (failures.length > 0) {
  console.error('Modern V18 platform guard failed.');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(
  `Modern V18 platform guard passed: ${REQUIRED.length} required surfaces, ${INDEX_EXPECTATIONS.length} barrel exports, strict TypeScript policy active.`,
);