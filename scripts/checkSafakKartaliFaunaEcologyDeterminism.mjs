import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/3d/gameplay/livingWorldFaunaEcologyDirector.js', import.meta.url), 'utf8');

function stripCommentsAndLiterals(value) {
  let output = '';
  let state = 'code';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (state === 'code') {
      if (char === '/' && next === '/') {
        output += '  ';
        state = 'lineComment';
        index += 1;
        continue;
      }
      if (char === '/' && next === '*') {
        output += '  ';
        state = 'blockComment';
        index += 1;
        continue;
      }
      if (char === '\\' && (next === '\"' || next === "'" || next === '`')) {
        output += '  ';
        index += 1;
        continue;
      }
      if (char === '\"' || char === "'" || char === '`') {
        output += ' ';
        state = char === '`' ? 'template' : 'literal';
        continue;
      }
      output += char;
      continue;
    }
    if (state === 'lineComment') {
      output += char === '\n' ? '\n' : ' ';
      if (char === '\n') state = 'code';
      continue;
    }
    if (state === 'blockComment') {
      output += char === '\n' ? '\n' : ' ';
      if (char === '*' && next === '/') {
        output += ' ';
        state = 'code';
        index += 1;
      }
      continue;
    }
    output += char === '\n' ? '\n' : ' ';
    if (char === '\\') {
      output += ' ';
      index += 1;
      continue;
    }
    if ((state === 'literal' && char === "'") || (state === 'literal' && char === '\"') || (state === 'template' && char === '`')) {
      state = 'code';
    }
  }
  return output;
}

const executableSource = stripCommentsAndLiterals(source);

assert.doesNotMatch(executableSource, /\bMath\.random\s*\(/, 'fauna director must not use ambient Math.random');
assert.doesNotMatch(executableSource, /\bDate\.now\s*\(/, 'fauna director must not use wall-clock Date.now');
assert.doesNotMatch(executableSource, /\bperformance\.now\s*\(/, 'fauna director must not use wall-clock performance.now');
assert.doesNotMatch(executableSource, /\brequestAnimationFrame\s*\(/, 'fauna director must not own frame scheduling');
assert.doesNotMatch(executableSource, /\bdocument\s*\./, 'fauna director must remain DOM-free');
assert.doesNotMatch(executableSource, /from\s+['\"]three['\"]/, 'fauna director must remain renderer-free');

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
assert.doesNotMatch(executableSource, mutableGlobalPattern, 'fauna director must not depend on mutable global runtime state');

console.log(JSON.stringify({
  contract: 'safak-kartali-fauna-ecology-determinism',
  deterministic: true,
  rendererFree: true,
  domFree: true,
  wallClockFree: true,
  frameSchedulerFree: true,
  exports: exportNames,
}));
