#!/usr/bin/env node
import fs from 'node:fs';

const modules = [
  ['01', 'Run277', 'worldReferencePindex01Detail.js', 'run277Pindex01Ready'],
  ['02', 'Run278', 'worldReferencePindex02Detail.js', 'run278Pindex02Ready'],
  ['03', 'Run281', 'worldReferencePindex03Detail.js', 'run281Pindex03Ready'],
  ['04', 'Run282', 'worldReferencePindex04Detail.js', 'run282Pindex04Ready'],
];

const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');
const canonicalBoot = fs.readFileSync('scripts/run201CanonicalDevBoot.mjs', 'utf8');

let previousServiceWorkerIndex = -1;
let previousBootIndex = -1;
for (const [pindex, run, filename, readyMarker] of modules) {
  const swToken = `./src/3d/world/${filename}`;
  const bootImport = `../src/3d/world/${filename}`;
  const swIndex = serviceWorker.indexOf(swToken);
  const bootIndex = canonicalBoot.indexOf(bootImport);
  if (swIndex < 0) throw new Error(`${run}/Pindex-${pindex} missing from offline shell`);
  if (bootIndex < 0) throw new Error(`${run}/Pindex-${pindex} missing from canonical-dev activation`);
  if (!canonicalBoot.includes(readyMarker)) throw new Error(`${run}/Pindex-${pindex} ready marker missing`);
  if (swIndex <= previousServiceWorkerIndex) throw new Error(`offline Pindex detail order regressed at Pindex-${pindex}`);
  if (bootIndex <= previousBootIndex) throw new Error(`canonical-dev Pindex detail order regressed at Pindex-${pindex}`);
  previousServiceWorkerIndex = swIndex;
  previousBootIndex = bootIndex;
}

for (const [pindex, run, filename] of modules) {
  const source = fs.readFileSync(`src/3d/world/${filename}`, 'utf8');
  if (!source.includes(`pindex: ${Number(pindex)}`)) throw new Error(`${run}/Pindex-${pindex} policy index changed`);
  if (source.includes('Math.random(')) throw new Error(`${run}/Pindex-${pindex} became non-deterministic`);
}

console.log('[checkRun284PindexDetailChain] PASS: Pindex-01→04 offline/runtime order and deterministic contracts locked');
