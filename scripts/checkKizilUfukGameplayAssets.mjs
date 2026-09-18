import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const manifestUrl = new URL('./assets_manifest.json', root);
const { PLAYER_CONFIG, NPC_CONFIG, ANIMAL_CONFIG, DRAGON_CONFIG, validateGameplayConfig } =
  await import(new URL('./src/3d/gameplay/gameplayConfig.ts', root));

validateGameplayConfig();
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
const knownAssetPaths = new Set(
  assets.flatMap((asset) => [asset?.file, asset?.textures]).filter((value) => typeof value === 'string'),
);

const roots = { PLAYER_CONFIG, NPC_CONFIG, ANIMAL_CONFIG, DRAGON_CONFIG };
const references = new Set();

function collectStrings(value) {
  if (typeof value === 'string') {
    if (value.startsWith('assets/')) references.add(value);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const nested of Object.values(value)) collectStrings(nested);
}

collectStrings(roots);

const missing = [...references].filter((assetPath) => !knownAssetPaths.has(assetPath)).sort();
if (missing.length > 0) {
  throw new Error(`Gameplay config references missing manifest assets:\n${missing.join('\n')}`);
}

const deprecated = assets
  .filter((asset) => asset?.deprecated === true && references.has(asset.file))
  .map((asset) => asset.file)
  .sort();
if (deprecated.length > 0) {
  throw new Error(`Gameplay config references deprecated assets:\n${deprecated.join('\n')}`);
}

const duplicateReferences = [...references].filter((assetPath) => {
  const matches = assets.filter((asset) => asset?.file === assetPath || asset?.textures === assetPath);
  return matches.length !== 1;
}).sort();
if (duplicateReferences.length > 0) {
  throw new Error(`Manifest must resolve each gameplay asset path to exactly one record:\n${duplicateReferences.join('\n')}`);
}

console.log(JSON.stringify({
  manifestAssetCount: assets.length,
  gameplayAssetReferenceCount: references.size,
  deprecatedReferenceCount: deprecated.length,
  deterministicAssetList: [...references].sort(),
}, null, 2));
