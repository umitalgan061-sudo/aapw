#!/usr/bin/env node
/**
 * Run306: locks the canonical-dev Pindex-01..05 micro-surface detail chain.
 *
 * Extends the Run284 Pindex-01..04 contract with the newly activated Pindex-05 layer without
 * modifying it, so the older guard keeps proving its own historical range independently.
 */
import fs from 'node:fs';

const RUN216_COMPLETE_MARKER = '// Run216 complete World Editor offline shell extension.';

const modules = [
  ['01', 'Run277', 'worldReferencePindex01Detail.js', 'run277Pindex01Ready'],
  ['02', 'Run278', 'worldReferencePindex02Detail.js', 'run278Pindex02Ready'],
  ['03', 'Run281', 'worldReferencePindex03Detail.js', 'run281Pindex03Ready'],
  ['04', 'Run282', 'worldReferencePindex04Detail.js', 'run282Pindex04Ready'],
  ['05', 'Run306', 'worldReferencePindex05Detail.js', 'run306Pindex05Ready'],
];

const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');
const canonicalBoot = fs.readFileSync('scripts/run201CanonicalDevBoot.mjs', 'utf8');

// Run303 kept the Run216 complete-cache marker as the exact first line; the Run306 prepend must not displace it.
if (!serviceWorker.startsWith(RUN216_COMPLETE_MARKER)) {
  throw new Error('Run216 complete cache marker prefix regressed');
}

let previousBootIndex = -1;
const serviceWorkerIndexes = [];
for (const [pindex, run, filename, readyMarker] of modules) {
  const swToken = `./src/3d/world/${filename}`;
  const bootImport = `../src/3d/world/${filename}`;
  const swIndex = serviceWorker.indexOf(swToken);
  const bootIndex = canonicalBoot.indexOf(bootImport);
  if (swIndex < 0) throw new Error(`${run}/Pindex-${pindex} missing from offline shell`);
  if (bootIndex < 0) throw new Error(`${run}/Pindex-${pindex} missing from canonical-dev activation`);
  if (!canonicalBoot.includes(readyMarker)) throw new Error(`${run}/Pindex-${pindex} ready marker missing`);
  if (bootIndex <= previousBootIndex) throw new Error(`canonical-dev Pindex detail order regressed at Pindex-${pindex}`);
  previousBootIndex = bootIndex;
  serviceWorkerIndexes.push(swIndex);
}

// Each Pindex run prepends its install listener, so offline registration stays reverse chronological
// (05→04→03→02→01) while canonical-dev execution stays chronological.
for (let index = 1; index < serviceWorkerIndexes.length; index += 1) {
  if (serviceWorkerIndexes[index] >= serviceWorkerIndexes[index - 1]) {
    throw new Error(`offline prepend order regressed between Pindex-${String(index).padStart(2, '0')} and Pindex-${String(index + 1).padStart(2, '0')}`);
  }
}

for (const [pindex, run, filename] of modules) {
  const source = fs.readFileSync(`src/3d/world/${filename}`, 'utf8');
  if (!source.includes(`pindex: ${Number(pindex)}`)) throw new Error(`${run}/Pindex-${pindex} policy index changed`);
  if (source.includes('Math.random(')) throw new Error(`${run}/Pindex-${pindex} became non-deterministic`);
  if (!source.includes(`if (c.pindex !== PINDEX${pindex}_DETAIL_POLICY.pindex) continue;`)) {
    throw new Error(`${run}/Pindex-${pindex} lost its single-pindex isolation guard`);
  }
}

// Pindex-05 is sea+soil only (453/187 canonical cells, zero rock/snow). Its per-vertex soil and sea
// amplitudes must stay at or below Run282's so the wider soil body cannot read noisier than Pindex-04.
const pindex04 = fs.readFileSync('src/3d/world/worldReferencePindex04Detail.js', 'utf8');
const pindex05 = fs.readFileSync('src/3d/world/worldReferencePindex05Detail.js', 'utf8');
function amplitude(source, surface) {
  const match = source.match(new RegExp(`${surface}: (\\d+(?:\\.\\d+)?)`));
  if (!match) throw new Error(`missing ${surface} amplitude`);
  return Number(match[1]);
}
for (const surface of ['sea', 'soil']) {
  if (amplitude(pindex05, surface) > amplitude(pindex04, surface)) {
    throw new Error(`Pindex-05 ${surface} amplitude exceeds Pindex-04 despite its larger soil share`);
  }
}

console.log('[checkRun306Pindex05DetailChain] PASS: chronological runtime + reverse-prepend offline Pindex-01→05 contracts locked');
