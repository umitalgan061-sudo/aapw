import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/3d/gameplay/livingWorldFaunaEcologyDirector.js', import.meta.url), 'utf8');

assert.doesNotMatch(source, /\bMath\.random\s*\(/, 'fauna director must not use ambient Math.random');
assert.doesNotMatch(source, /\bDate\.now\s*\(/, 'fauna director must not use wall-clock Date.now');
assert.doesNotMatch(source, /\bperformance\.now\s*\(/, 'fauna director must not use wall-clock performance.now');
assert.doesNotMatch(source, /\brequestAnimationFrame\s*\(/, 'fauna director must not own frame scheduling');
assert.doesNotMatch(source, /\bdocument\s*\./, 'fauna director must remain DOM-free');
assert.doesNotMatch(source, /from\s+['\"]three['\"]/, 'fauna director must remain renderer-free');

const exportNames = [
  'planLivingWorldFaunaEcologyTick',
  'buildFaunaEcologyReplayTape',
  'compareFaunaEcologyReplays',
  'applyLivingWorldFaunaEcologyPlan',
  'auditFaunaEcologyAssetBearingSpawns',
  'validateFaunaEcologyInput',
  'summarizeFaunaEcology',
  'getFaunaEcologyLod',
  'getFaunaEcologyTickInterval',
];
for (const name of exportNames) assert.match(source, new RegExp(`export function ${name}\\b`), `missing director export: ${name}`);

const mutableGlobalPattern = /globalThis\.|process\.env|localStorage|sessionStorage/;
assert.doesNotMatch(source, mutableGlobalPattern, 'fauna director must not depend on mutable global runtime state');

console.log(JSON.stringify({
  contract: 'safak-kartali-fauna-ecology-determinism',
  deterministic: true,
  rendererFree: true,
  domFree: true,
  wallClockFree: true,
  frameSchedulerFree: true,
  exports: exportNames,
}));
