import { readFile, stat, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(new URL('..', import.meta.url).pathname);
const fail = [];
const manifest = JSON.parse(await readFile(resolve(root, 'assets_manifest.json'), 'utf8'));
const read = async (rel) => { try { return await readFile(resolve(root, rel), 'utf8'); } catch { fail.push(`missing:${rel}`); return ''; } };
const mustBeHydrated = async (rel) => { try { const path = resolve(root, rel); const [body, info] = await Promise.all([readFile(path), stat(path)]); const text = body.toString('utf8'); if (info.size < 128) fail.push(`asset-too-small:${rel}`); if (text.startsWith('version https://git-lfs.github.com/spec/v1')) fail.push(`lfs-pointer-not-hydrated:${rel}`); } catch { fail.push(`missing-asset:${rel}`); } };
const ownerPaths = ['player.ts', 'playerConfig.ts', 'health.ts', 'dragonFlightMath.ts', 'dragonReactionState.ts', 'dragonConfig.ts', 'npcConfig.ts', 'animalConfig.ts'];
const ownerBodies = await Promise.all(ownerPaths.map((name) => read(`src/3d/gameplay/${name}`)));
const [player, playerConfig, playerShim, configShim] = await Promise.all([read('src/3d/gameplay/player.ts'), read('src/3d/gameplay/playerConfig.ts'), read('src/3d/gameplay/player.js'), read('src/3d/gameplay/playerConfig.js')]);
for (const [name, body] of ownerPaths.map((name, i) => [name, ownerBodies[i]])) { if (body.includes('@ts-nocheck')) fail.push(`${name}:ts-nocheck`); if (!body.includes('Production TypeScript owner')) fail.push(`${name}:owner-marker`); }
for (const [name, body, target] of [['player.js', playerShim, './player.ts'], ['playerConfig.js', configShim, './playerConfig.ts']]) { if (!body.includes('TypeScript ownership compatibility boundary.')) fail.push(`${name}:compatibility-marker`); if (!body.includes(`from '${target}'`)) fail.push(`${name}:typed-target`); }
if (/EditorMaterialStudio|from\s+['"][^'"]*editor/i.test(player)) fail.push('player.ts:editor-runtime-import');
if (/MaterialAssignmentCore|WorldAssetPlacementPipeline/.test(player)) fail.push('player.ts:duplicate-material-placement-authority');
const config = await import(resolve(root, 'src/3d/gameplay/playerConfig.ts'));
const assetUrls = [config.PLAYER_CONFIG.MODEL_URL, ...Object.values(config.PLAYER_CONFIG.ANIMATION_URLS)];
for (const url of assetUrls) await mustBeHydrated(url);
try { const entries = await readdir(resolve(root, 'assets/animations/peasant_girl')); const fbx = entries.filter((name) => name.toLowerCase().endsWith('.fbx')); if (fbx.length < 3) fail.push(`animation-family-incomplete:${fbx.length}`); } catch { fail.push('animation-family-missing'); }
if (fail.length) { console.error(`Player modernization proof failed with ${fail.length} issue(s).`); for (const issue of fail) console.error(`- ${issue}`); process.exit(1); }
console.log(JSON.stringify({ pass:true, controller:'strict-typescript', editorRuntimeImport:false, duplicateMaterialPlacementAuthority:false, assetUrls:assetUrls.length, assetHydrationFailures:0, animationFamily:'peasant_girl' }));