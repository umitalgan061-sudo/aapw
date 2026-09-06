import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const args = new Set(argv);
const enforce = args.has('--enforce');
const valueFor = (flag, fallback) => {
    const index = argv.indexOf(flag);
    if (index < 0) return fallback;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
        console.error(`[npc-owned-offline-shell] FAIL: ${flag} requires a non-empty ref`);
        process.exit(2);
    }
    return value;
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
const shellEntries = new Set(
    [...sw.matchAll(/GAME3D_SHELL_FILES\.push\(['"]\.\/(src\/3d\/[^'"]+\.js)['"]\)/g)]
        .map(([, path]) => path),
);
const missing = ownedRuntimeJs.filter(path => !shellEntries.has(path));
const summary = {
    base,
    head,
    runtimeJs: ownedRuntimeJs,
    shellEntries: shellEntries.size,
    missing,
    enforce,
};

console.log(`[npc-owned-offline-shell] base=${summary.base}`);
console.log(`[npc-owned-offline-shell] head=${summary.head}`);
console.log(`[npc-owned-offline-shell] runtime-js=${summary.runtimeJs.length}`);
for (const path of summary.runtimeJs) console.log(`  owned: ${path}`);
console.log(`[npc-owned-offline-shell] shell-entries=${summary.shellEntries}`);
console.log(`[npc-owned-offline-shell] missing=${summary.missing.length}`);
for (const path of summary.missing) console.log(`  missing: ${path}`);

// Keep diagnostic mode non-blocking for shared gates; callers that own the shell can opt into enforcement.
if (enforce && missing.length) {
    console.error('[npc-owned-offline-shell] FAIL: branch-owned runtime files are not in service-worker.js');
    process.exitCode = 1;
} else if (!missing.length) {
    console.log('[npc-owned-offline-shell] PASS: missing=0');
}
