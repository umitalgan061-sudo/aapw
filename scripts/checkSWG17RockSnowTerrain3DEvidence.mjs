import fs from 'node:fs';
import path from 'node:path';

function value(flag) {
  const arg = process.argv.find((candidate) => candidate.startsWith(`${flag}=`));
  if (!arg) throw new Error(`missing ${flag}=...`);
  return arg.slice(flag.length + 1);
}

function metric(pathname, prefix) {
  for (const line of fs.readFileSync(pathname, 'utf8').split(/\r?\n/)) {
    if (line.startsWith(prefix)) return JSON.parse(line.slice(prefix.length));
  }
  throw new Error(`${prefix} missing from ${pathname}`);
}

const logA = value('--log-a');
const logB = value('--log-b');
const previewA = value('--preview-a');
const previewB = value('--preview-b');
const out = value('--out');
const prefix = 'G17_TERRAIN3D_ROCK_SNOW_METRICS=';
const a = metric(logA, prefix);
const b = metric(logB, prefix);

const stableKeys = [
  'terrain3dVersion',
  'regionSize',
  'regionCount',
  'alignedSamples',
  'seamSamples',
  'controlSeamSamples',
  'maxHeightError',
  'maxBlendError',
  'maxSeamHeightError',
  'maxSeamBlendError',
  'maxSourceSnowWeight',
  'outputChecksum',
  'bakedSurfaces',
  'bakedVertices',
  'savedRegionFiles',
];
for (const key of stableKeys) {
  if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) throw new Error(`Terrain3D semantic determinism failed for ${key}: ${a[key]} != ${b[key]}`);
}

if (!String(a.terrain3dVersion).startsWith('1.0.2')) throw new Error(`unexpected Terrain3D version ${a.terrain3dVersion}`);
if (a.regionSize !== 256 || a.regionCount < 4) throw new Error(`unexpected Terrain3D region evidence ${a.regionSize}/${a.regionCount}`);
if (a.alignedSamples !== 4225 || a.seamSamples !== 48 || a.controlSeamSamples !== 20) throw new Error('Terrain3D G17 Rock/Snow proof sample coverage drifted');
if (a.maxHeightError > 0.012 || a.maxBlendError > 0.006) throw new Error('Terrain3D G17 Rock/Snow aligned roundtrip exceeded tolerance');
if (a.maxSeamHeightError > 0.02 || a.maxSeamBlendError > 0.006) throw new Error('Terrain3D G17 Rock/Snow seam roundtrip exceeded tolerance');
if (a.maxSourceSnowWeight !== 0) throw new Error('Terrain3D G17 Rock/Snow proof invented snow');
if (a.bakedSurfaces < 1 || a.bakedVertices <= 0) throw new Error('Terrain3D G17 Rock/Snow LOD0 bake missing');
if (a.savedRegionFiles < 4 || a.savedRegionBytes <= 0 || b.savedRegionBytes <= 0) throw new Error('Terrain3D G17 Rock/Snow persistence evidence missing');

const pngA = fs.readFileSync(previewA);
const pngB = fs.readFileSync(previewB);
if (!pngA.equals(pngB)) throw new Error('Terrain3D G17 Rock/Snow top-down preview is not byte deterministic');

const manifest = {
  schema: 'westeros-g17-rock-snow-terrain3d-evidence-v1',
  stableKeys,
  metrics: a,
  previewBytes: pngA.length,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`SW_G17_ROCK_SNOW_TERRAIN3D_EVIDENCE=${JSON.stringify(manifest)}`);
console.log('SW_G17_ROCK_SNOW_TERRAIN3D_EVIDENCE_OK');
