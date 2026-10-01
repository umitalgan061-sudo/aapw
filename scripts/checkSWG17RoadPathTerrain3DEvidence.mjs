import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function value(flag) {
  const arg = process.argv.find((candidate) => candidate.startsWith(`${flag}=`));
  if (!arg) throw new Error(`missing ${flag}=...`);
  return arg.slice(flag.length + 1);
}

function metric(file, prefix) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.startsWith(prefix)) return JSON.parse(line.slice(prefix.length));
  }
  throw new Error(`${prefix} missing from ${file}`);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

const logA = value('--log-a');
const logB = value('--log-b');
const previewA = value('--preview-a');
const previewB = value('--preview-b');
const source = value('--source');
const out = value('--out');
const prefix = 'G17_TERRAIN3D_ROAD_PATH_METRICS=';
const a = metric(logA, prefix);
const b = metric(logB, prefix);
const sourceEvidence = JSON.parse(fs.readFileSync(source, 'utf8'));

const stableKeys = [
  'terrain3dVersion', 'regionSize', 'regions', 'samples', 'seamSamples',
  'phantomRoadPathSamples', 'maxHeightError', 'maxBlendError', 'maxColorError',
  'maxRoughnessError', 'maxSeamHeightError', 'maxSeamBlendError',
  'maxSeamColorError', 'maxSeamRoughnessError', 'checksum', 'bakedSurfaces',
  'bakedVertices', 'savedRegionFiles',
  'roadGuardCrossings', 'pathGuardCrossings',
];
for (const key of stableKeys) {
  if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
    throw new Error(`Terrain3D Road/Path determinism failed for ${key}: ${a[key]} != ${b[key]}`);
  }
}

if (!String(a.terrain3dVersion).startsWith('1.0.2')) throw new Error(`unexpected Terrain3D ${a.terrain3dVersion}`);
if (a.regionSize !== 256 || a.regions < 4) throw new Error('Terrain3D region proof missing');
if (a.samples !== 4225 || a.seamSamples !== 68) throw new Error('Road/Path sample coverage drifted');
if (a.phantomRoadPathSamples !== 0 || a.roadGuardCrossings !== 0 || a.pathGuardCrossings !== 0) {
  throw new Error('phantom Road/Path evidence is non-zero');
}
if (a.maxHeightError > 0.012 || a.maxBlendError > 0.006 || a.maxColorError > 0.006 || a.maxRoughnessError > 0.006) {
  throw new Error('aligned Terrain3D Road/Path roundtrip exceeded tolerance');
}
if (a.maxSeamHeightError > 0.012 || a.maxSeamBlendError > 0.006 || a.maxSeamColorError > 0.006 || a.maxSeamRoughnessError > 0.006) {
  throw new Error('Terrain3D Road/Path 255/256 seam roundtrip exceeded tolerance');
}
if (a.bakedSurfaces < 1 || a.bakedVertices <= 0) throw new Error('LOD0 bake evidence missing');
if (a.savedRegionFiles < 4 || b.savedRegionFiles < 4 || a.savedRegionBytes <= 0 || b.savedRegionBytes <= 0) throw new Error('save/reload region evidence missing');

const pngA = fs.readFileSync(previewA);
const pngB = fs.readFileSync(previewB);
if (!pngA.equals(pngB)) throw new Error('Road/Path imported top-down is not byte deterministic');
if (pngA.length < 1000) throw new Error(`Road/Path imported top-down suspiciously small: ${pngA.length}`);

const route = sourceEvidence.routeEvidence;
if (!route || route.roadGuardCrossingSegments !== 0 || route.pathGuardCrossingSegments !== 0) {
  throw new Error('source evidence contains G17 guard-band route crossings');
}
if (sourceEvidence.coverage?.activeSamples !== 0 || sourceEvidence.coverage?.maxCoverage !== 0) {
  throw new Error('source evidence contains active open-sea road/path coverage');
}

const manifest = {
  schema: 'westeros-g17-road-path-terrain3d-evidence-v2',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  sourceMapVersion: sourceEvidence.sourceMapVersion,
  sourceMapSize: sourceEvidence.sourceMapSize,
  terrain3d: a, persistenceBytes: [a.savedRegionBytes, b.savedRegionBytes],
  routeEvidence: route,
  previewBytes: pngA.length,
  previewSha256: sha256(pngA),
  semanticDeterminismKeys: stableKeys,
  negativePhysicalProof: true,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`SW_G17_ROAD_PATH_TERRAIN3D_EVIDENCE=${JSON.stringify(manifest)}`);
console.log('SW_G17_ROAD_PATH_TERRAIN3D_EVIDENCE_OK');
