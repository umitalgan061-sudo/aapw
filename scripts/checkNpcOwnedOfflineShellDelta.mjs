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
const shellEntrySources = new Map();
const remember = (path, source) => {
    if (!shellEntrySources.has(path)) shellEntrySources.set(path, source);
};
for (const match of sw.matchAll(/GAME3D_SHELL_FILES\.push\(['"]\.\/(src\/3d\/[^'"]+\.js)['"]\)/g)) {
    remember(match[1], 'push');
}
for (const match of sw.matchAll(/['"]\.\/(src\/3d\/[^'"]+\.js)['"]/g)) {
    remember(match[1], 'static');
}
const shellEntries = new Set(shellEntrySources.keys());
const missing = ownedRuntimeJs.filter(path => !shellEntries.has(path));
const summary = {
    base,
    head,
    runtimeJs: ownedRuntimeJs,
    shellEntries: shellEntries.size,
    missing,
    missingRemediation: missing.map(path => ({
        path,
        requiredEntry: `GAME3D_SHELL_FILES.push('./${path}');`,
        serviceWorker: 'service-worker.js',
    })),
    enforce,
};

console.log(`[npc-owned-offline-shell] base=${summary.base}`);
console.log(`[npc-owned-offline-shell] head=${summary.head}`);
console.log(`[npc-owned-offline-shell] runtime-js=${summary.runtimeJs.length}`);
for (const path of summary.runtimeJs) {
    const source = shellEntrySources.get(path) ?? 'missing';
    console.log(`  owned: ${path} source=${source}`);
}
console.log(`[npc-owned-offline-shell] shell-entries=${summary.shellEntries}`);
console.log(`[npc-owned-offline-shell] missing=${summary.missing.length}`);
for (const item of summary.missingRemediation) {
    console.log(`  missing: ${item.path}`);
    console.log(`  remediation: add ${item.requiredEntry} to ${item.serviceWorker}`);
}
if (enforce && missing.length) {
    console.error('[npc-owned-offline-shell] FAIL: branch-owned runtime files are not in service-worker.js');
    process.exitCode = 1;
} else if (!missing.length) {
    console.log('[npc-owned-offline-shell] PASS: missing=0');
}
