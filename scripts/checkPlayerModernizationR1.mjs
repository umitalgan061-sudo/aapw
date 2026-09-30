import { readFile, stat, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const gameplay = resolve(root, 'src/3d/gameplay');
const fail = [];
async function read(rel) {
  try { return await readFile(resolve(root, rel), 'utf8'); }
  catch { fail.push(`missing:${rel}`); return ''; }
}
async function mustBeHydrated(rel) {
  const path = resolve(root, rel);
  try {
    const [body, info] = await Promise.all([readFile(path), stat(path)]);
    const text = body.toString('utf8');
    if (info.size < 128) fail.push(`asset-too-small:${rel}`);
    if (text.startsWith('version https://git-lfs.github.com/spec/v1')) fail.push(`lfs-pointer-not-hydrated:${rel}`);
  } catch { fail.push(`missing-asset:${rel}`); }
}

const player = await read('src/3d/gameplay/player.ts');
const playerConfig = await read('src/3d/gameplay/playerConfig.ts');
const playerShim = await read('src/3d/gameplay/player.js');
const configShim = await read('src/3d/gameplay/playerConfig.js');
const config = await import(resolve(gameplay, 'playerConfig.ts'));

for (const [name, body] of [['player.ts', player], ['playerConfig.ts', playerConfig]]) {
  if (body.includes('@ts-nocheck')) fail.push(`${name}:ts-nocheck`);
  if (!body.includes('Production TypeScript owner')) fail.push(`${name}:owner-marker`);
}
for (const [name, body, target] of [['player.js', playerShim, './player.ts'], ['playerConfig.js', configShim, './playerConfig.ts']]) {
  if (!body.includes('TypeScript ownership compatibility boundary.')) fail.push(`${name}:compatibility-marker`);
  if (!body.includes(`from '${target}'`)) fail.push(`${name}:typed-target`);
}
if (/EditorMaterialStudio|from\s+['"][^'"]*editor/i.test(player)) fail.push('player.ts:editor-runtime-import');
if (/MaterialAssignmentCore|WorldAssetPlacementPipeline/.test(player)) fail.push('player.ts:duplicate-material-placement-authority');

const assetUrls = [config.PLAYER_CONFIG.MODEL_URL, ...Object.values(config.PLAYER_CONFIG.ANIMATION_URLS)];
for (const url of assetUrls) await mustBeHydrated(url);

const animationDir = resolve(root, 'assets/animations/peasant_girl');
try {
  const entries = await readdir(animationDir);
  const fbx = entries.filter((name) => name.toLowerCase().endsWith('.fbx'));
  if (fbx.length < 3) fail.push(`animation-family-incomplete:${fbx.length}`);
  else for (const name of fbx) await mustBeHydrated(`assets/animations/peasant_girl/${name}`);
} catch { fail.push('animation-family-missing'); }

if (fail.length) {
  console.error(`Player modernization proof failed with ${fail.length} issue(s).`);
  for (const issue of fail) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(JSON.stringify({ pass: true, controller: 'strict-typescript', editorRuntimeImport: false, duplicateMaterialPlacementAuthority: false, assetUrls: assetUrls.length, assetHydrationFailures: 0, animationFamily: 'peasant_girl' }));