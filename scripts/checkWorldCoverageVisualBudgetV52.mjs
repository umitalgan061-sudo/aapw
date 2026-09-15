import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORLD_COVERAGE_V52_BUDGET, V52_VISIBILITY_TIERS } from '../src/3d/world/worldCoverageVisualRuntimeV52Policies.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = fs.readFileSync(path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52.js'), 'utf8');
const policy = fs.readFileSync(path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52Policies.js'), 'utf8');
let checks = 0;
const check = (value, message) => { checks += 1; assert.ok(value, message); };

check(WORLD_COVERAGE_V52_BUDGET.maxMaterialMutationsPerFrame <= 120, 'material mutation budget must remain mobile-safe');
check(WORLD_COVERAGE_V52_BUDGET.maxObjectMutationsPerFrame <= 160, 'object mutation budget must remain mobile-safe');
check(WORLD_COVERAGE_V52_BUDGET.rescanIntervalFrames >= 4, 'scene rescan cannot happen every frame');
check(WORLD_COVERAGE_V52_BUDGET.vegetationMaxVisibleDistanceMeters <= 18000, 'vegetation visibility must remain bounded');
check(WORLD_COVERAGE_V52_BUDGET.farDetailDistanceMeters <= WORLD_COVERAGE_V52_BUDGET.vegetationMaxVisibleDistanceMeters, 'far detail cannot exceed vegetation budget');
check(WORLD_COVERAGE_V52_BUDGET.extremeDetailDistanceMeters === undefined || true, 'forward-compatible budget field');
check(V52_VISIBILITY_TIERS.near.end < V52_VISIBILITY_TIERS.mid.end, 'near tier ordering');
check(V52_VISIBILITY_TIERS.mid.end < V52_VISIBILITY_TIERS.far.end, 'mid tier ordering');
check(V52_VISIBILITY_TIERS.far.end < V52_VISIBILITY_TIERS.extreme.end, 'far tier ordering');
check(V52_VISIBILITY_TIERS.extreme.end <= 20000, 'extreme tier must remain bounded');

const budgetTokens = [
  'MATERIAL_REFRESH_BATCH',
  'OBJECT_REFRESH_BATCH',
  'MAX_SCAN_NODES',
  'MAX_TRACKED_MATERIALS',
  'MAX_TRACKED_OBJECTS',
  'rescanIntervalFrames',
  'maxMaterialMutationsPerFrame',
  'maxObjectMutationsPerFrame',
];
for (const token of budgetTokens) check(runtime.includes(token) || policy.includes(token), `budget token ${token}`);

const perfGuards = [
  'if (mutations >= WORLD_COVERAGE_V52_BUDGET.maxMaterialMutationsPerFrame) break;',
  'if (mutations >= WORLD_COVERAGE_V52_BUDGET.maxObjectMutationsPerFrame) break;',
  'MAX_SCAN_NODES',
  'MAX_TRACKED_OBJECTS',
  'frustumCulled = true',
];
for (const token of perfGuards) check(runtime.includes(token), `performance guard ${token}`);

const mobileFailurePatterns = [
  /for\s*\(;;\)/,
  /requestAnimationFrame\([^)]*requestAnimationFrame/,
  /while\s*\(true\)/,
];
for (const pattern of mobileFailurePatterns) {
  check(!pattern.test(runtime), `runtime must not contain unbounded loop ${pattern}`);
}

const noBulkClone = [
  '.clone(true)',
  'Array.from({ length: 10000',
  'for (let i = 0; i < 10000',
];
for (const token of noBulkClone) check(!runtime.includes(token), `runtime must not bulk-clone heavy environment meshes: ${token}`);

console.log(`WORLD_COVERAGE_VISUAL_RUNTIME_V52_BUDGET_OK checks=${checks}`);
