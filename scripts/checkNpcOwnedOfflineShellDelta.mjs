import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const enforce = args.has('--enforce');
const valueFor = (flag, fallback) => {
    const index = process.argv.indexOf(flag);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const base = valueFor('--base', execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim());
const head = valueFor('--head', execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
for (const [label, ref] of [['base', base], ['head', head]]) {
    try {
        execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], { stdio: 'ignore' });
    } catch {
        console.error(`[npc-owned-offline-shell] FAIL: ${label} is not a resolvable commit: ${ref}`);
        process.exit(2);
    }
}
const changed = execFileSync(
    'git',
    ['diff', '--name-status', `${base}...${head}`, '--', 'src/3d'],
    { encoding: 'utf8' },
).trim().split('\n').filter(Boolean);

const ownedRuntimeJs = [...new Set(changed
    .map(line => line.split('\t'))
    .filter(([status, path]) => status !== 'D' && path?.endsWith('.js'))
    .map(([, path]) => path)
    .sort())];

const sw = fs.readFileSync('service-worker.js', 'utf8');
const missing = ownedRuntimeJs.filter(path => !sw.includes(`./${path}`));
const summary = {
    base,
    head,
    runtimeJs: ownedRuntimeJs,
    missing,
    enforce,
};

console.log(`[npc-owned-offline-shell] base=${summary.base}`);
console.log(`[npc-owned-offline-shell] head=${summary.head}`);
console.log(`[npc-owned-offline-shell] runtime-js=${summary.runtimeJs.length}`);
for (const path of summary.runtimeJs) console.log(`  owned: ${path}`);
console.log(`[npc-owned-offline-shell] missing=${summary.missing.length}`);
for (const path of summary.missing) console.log(`  missing: ${path}`);

// Keep diagnostic mode non-blocking for shared gates; callers that own the shell can opt into enforcement.
if (enforce && missing.length) {
    console.error('[npc-owned-offline-shell] FAIL: branch-owned runtime files are not in service-worker.js');
    process.exitCode = 1;
} else if (!missing.length) {
    console.log('[npc-owned-offline-shell] PASS: missing=0');
}
