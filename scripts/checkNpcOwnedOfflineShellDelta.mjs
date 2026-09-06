import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const base = execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim();
const changed = execFileSync(
  'git',
  ['diff', '--name-status', `${base}...HEAD`, '--', 'src/3d'],
  { encoding: 'utf8' }
).trim().split('\n').filter(Boolean);

const ownedRuntimeJs = changed
  .map(line => line.split('\t'))
  .filter(([status, path]) => status !== 'D' && path?.endsWith('.js'))
  .map(([, path]) => path)
  .sort();

const sw = fs.readFileSync('service-worker.js', 'utf8');
const missing = ownedRuntimeJs.filter(path => !sw.includes(`./${path}`));

console.log(`[npc-owned-offline-shell] base=${base}`);
console.log(`[npc-owned-offline-shell] runtime-js=${ownedRuntimeJs.length}`);
for (const path of ownedRuntimeJs) console.log(`  owned: ${path}`);

if (missing.length) {
  console.log(`[npc-owned-offline-shell] missing=${missing.length}`);
  for (const path of missing) console.log(`  missing: ${path}`);
} else {
  console.log('[npc-owned-offline-shell] missing=0');
}

// Diagnostic only: the repository-wide checkServiceWorkerCache.js remains the fail-closed gate.
// This classifier exists to distinguish this PR's own offline-shell debt from concurrent world debt.
process.exitCode = 0;
