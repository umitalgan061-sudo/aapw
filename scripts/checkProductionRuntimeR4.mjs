import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = process.cwd();

const REQUIRED_FILES = [
  'src/3d/modern/next/production/contracts.ts',
  'src/3d/modern/next/production/eventRouter.ts',
  'src/3d/modern/next/production/entityRegistry.ts',
  'src/3d/modern/next/production/renderRuntime.ts',
  'src/3d/modern/next/production/networkRuntime.ts',
  'src/3d/modern/next/production/persistenceRuntime.ts',
  'src/3d/modern/next/production/observability.ts',
  'src/3d/modern/next/production/lifecycle.ts',
  'src/3d/modern/next/production/runtimeController.ts',
  'src/3d/modern/next/production/browserBridge.ts',
  'src/3d/modern/next/production/diagnostics.ts',
  'src/3d/modern/next/production/migrationGuard.ts',
  'src/3d/modern/next/production/acceptance.ts',
  'src/3d/modern/next/production/index.ts',
  'tests/modern/productionRuntimeR4.test.ts',
  'tests/modern/productionRuntimeR4Acceptance.test.ts',
];

const REQUIRED_EXPORTS = {
  'src/3d/modern/next/production/contracts.ts': [
    'PRODUCTION_CONTRACT_VERSION',
    'normalizeRuntimeIdentity',
    'normalizeRuntimeCapabilities',
    'normalizeBudget',
  ],
  'src/3d/modern/next/production/eventRouter.ts': [
    'TypedRuntimeEventRouter',
    'bridgeRuntimeEvent',
    'bridgeRuntimeEvents',
  ],
  'src/3d/modern/next/production/entityRegistry.ts': [
    'ProductionEntityRegistry',
  ],
  'src/3d/modern/next/production/renderRuntime.ts': [
    'ProductionRenderPlanner',
    'resolveBrowserRenderCapabilities',
    'deriveRenderBudget',
    'estimatePlanWork',
    'canUseAdvancedShadows',
  ],
  'src/3d/modern/next/production/networkRuntime.ts': [
    'ProductionNetworkRuntime',
    'makeProductionEnvelope',
  ],
  'src/3d/modern/next/production/persistenceRuntime.ts': [
    'MemoryPersistenceStore',
    'WebStoragePersistenceStore',
    'ProductionPersistenceRuntime',
  ],
  'src/3d/modern/next/production/observability.ts': [
    'ProductionObservability',
    'buildInitialHealth',
  ],
  'src/3d/modern/next/production/lifecycle.ts': [
    'ProductionLifecycleSupervisor',
    'createLifecycleIdentity',
  ],
  'src/3d/modern/next/production/runtimeController.ts': [
    'ProductionRuntimeController',
    'createProductionRuntimeController',
  ],
  'src/3d/modern/next/production/browserBridge.ts': [
    'LegacyRuntimeBridge',
    'detectBrowserAdapters',
    'createLegacyRuntimeBridge',
  ],
  'src/3d/modern/next/production/diagnostics.ts': [
    'ProductionDiagnosticsService',
    'buildSubsystemMatrix',
  ],
  'src/3d/modern/next/production/migrationGuard.ts': [
    'verifyMigrationBoundaries',
    'renderMigrationReport',
  ],
  'src/3d/modern/next/production/acceptance.ts': [
    'buildProductionAcceptanceGates',
    'runProductionAcceptanceSuite',
    'summarizeAcceptance',
    'acceptanceExitCode',
  ],
  'src/3d/modern/next/production/index.ts': [
    "export * from './contracts.ts'",
    "export * from './runtimeController.ts'",
    "export * from './acceptance.ts'",
  ],
};

const FORBIDDEN_PATTERNS = [
  /eval\s*\(/,
  /new\s+Function\s*\(/,
  /document\.write\s*\(/,
  /innerHTML\s*=/,
];

const DETERMINISTIC_PATTERNS = [
  /Math\.random\s*\(/,
];

const LEGACY_BOUNDARIES = [
  'src/3d/config.js',
  'src/3d/eventBus.js',
  'src/3d/state.js',
  'src/3d/sceneManager.js',
];

const result = {
  files: 0,
  exports: 0,
  forbidden: 0,
  determinism: 0,
  boundaries: 0,
  scripts: 0,
  errors: [],
};

function fail(message) {
  result.errors.push(message);
}

async function exists(path) {
  try {
    await access(resolve(ROOT, path));
    return true;
  } catch {
    return false;
  }
}

async function read(path) {
  try {
    return await readFile(resolve(ROOT, path), 'utf8');
  } catch (error) {
    fail(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
}

async function checkRequiredFiles() {
  for (const path of REQUIRED_FILES) {
    if (!await exists(path)) {
      fail(`missing required production file: ${path}`);
      continue;
    }
    result.files += 1;
  }
}

async function checkExports() {
  for (const [path, symbols] of Object.entries(REQUIRED_EXPORTS)) {
    const content = await read(path);
    for (const symbol of symbols) {
      result.exports += 1;
      if (!content.includes(symbol)) fail(`missing export/surface marker ${symbol} in ${path}`);
    }
  }
}

async function checkSourceSafety() {
  const sources = REQUIRED_FILES.filter((path) => path.endsWith('.ts'));
  for (const path of sources) {
    const content = await read(path);
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        result.forbidden += 1;
        fail(`forbidden dynamic primitive ${pattern} detected in ${path}`);
      }
    }
    if (path.includes('/determinism.ts') || path.includes('/replay.ts') || path.includes('/networkRuntime.ts')) {
      for (const pattern of DETERMINISTIC_PATTERNS) {
        if (pattern.test(content)) {
          result.determinism += 1;
          fail(`nondeterministic primitive ${pattern} detected in ${path}`);
        }
      }
    }
  }
}

async function checkLegacyBoundaries() {
  for (const path of LEGACY_BOUNDARIES) {
    if (!await exists(path)) fail(`legacy compatibility boundary missing: ${path}`);
    else result.boundaries += 1;
  }
}

async function checkPackageScripts() {
  const packageText = await read('package.json');
  let pkg;
  try {
    pkg = JSON.parse(packageText);
  } catch {
    fail('package.json is not valid JSON');
    return;
  }
  const scripts = pkg.scripts ?? {};
  const required = [
    'typecheck',
    'test',
    'build:modern',
    'verify:production-runtime-r4',
    'test:production-runtime-r4',
    'check:production-runtime-r4',
  ];
  for (const name of required) {
    result.scripts += 1;
    if (typeof scripts[name] !== 'string') fail(`missing package script: ${name}`);
  }
  if (pkg.type !== 'module') fail('package must remain native ESM');
  if (!String(pkg.engines?.node ?? '').includes('24')) fail('Node 24 runtime baseline is missing');
  if (!pkg.devDependencies?.typescript) fail('TypeScript dependency is missing');
}

async function checkNextBarrel() {
  const indexPath = 'src/3d/modern/next/index.ts';
  const content = await read(indexPath);
  if (!content.includes("export * from './production/index.ts'")) {
    fail('modern next barrel does not expose production runtime');
  }
  if (!content.includes("export * from './runtime.ts'")) {
    fail('modern next barrel lost core runtime export');
  }
}

async function checkCompatibilityBarrels() {
  const config = await read('src/3d/config.js');
  const events = await read('src/3d/eventBus.js');
  const state = await read('src/3d/state.js');
  const scene = await read('src/3d/sceneManager.js');
  if (!config.includes("./config.ts")) fail('config.js compatibility barrel no longer targets config.ts');
  if (!events.includes("./eventBus.ts")) fail('eventBus.js compatibility barrel no longer targets eventBus.ts');
  if (!state.includes("./state.ts")) fail('state.js compatibility barrel no longer targets state.ts');
  if (!scene.includes("./sceneManager.ts")) fail('sceneManager.js compatibility barrel no longer targets sceneManager.ts');
}

async function checkTestReachability() {
  for (const path of [
    'tests/modern/productionRuntimeR4.test.ts',
    'tests/modern/productionRuntimeR4Acceptance.test.ts',
  ]) {
    const content = await read(path);
    if (!content.includes("from 'vitest'")) fail(`test does not use Vitest: ${path}`);
    if (!content.includes("describe(")) fail(`test suite missing describe(): ${path}`);
    if (!content.includes("expect(")) fail(`test suite missing assertions: ${path}`);
  }
}

async function checkLineCaps() {
  for (const path of REQUIRED_FILES.filter((value) => value.endsWith('.ts'))) {
    const content = await read(path);
    const lines = content.split(/\r?\n/).length;
    if (lines > 650) fail(`production file exceeds maintainability line cap: ${path} (${lines})`);
  }
}

await checkRequiredFiles();
await checkExports();
await checkSourceSafety();
await checkLegacyBoundaries();
await checkPackageScripts();
await checkNextBarrel();
await checkCompatibilityBarrels();
await checkTestReachability();
await checkLineCaps();

const checks = [
  ['files', result.files, REQUIRED_FILES.length],
  ['exports', result.exports, Object.values(REQUIRED_EXPORTS).flat().length],
  ['legacy boundaries', result.boundaries, LEGACY_BOUNDARIES.length],
];

for (const [name, actual, expected] of checks) {
  if (actual !== expected) fail(`${name} check incomplete: ${actual}/${expected}`);
}

console.log('AAPW production runtime R4 verifier');
console.log(`files: ${result.files}/${REQUIRED_FILES.length}`);
console.log(`exports: ${result.exports}/${Object.values(REQUIRED_EXPORTS).flat().length}`);
console.log(`legacy boundaries: ${result.boundaries}/${LEGACY_BOUNDARIES.length}`);
console.log(`package scripts checked: ${result.scripts}`);
console.log(`forbidden patterns: ${result.forbidden}`);
console.log(`determinism findings: ${result.determinism}`);

if (result.errors.length) {
  console.error(`FAIL — ${result.errors.length} issue(s)`);
  for (const error of result.errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('PASS — production runtime R4 structural gate is satisfied');
}
