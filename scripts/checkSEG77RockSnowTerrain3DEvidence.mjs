import fs from 'node:fs';

function parseMetrics(file, prefix) {
  const text = fs.readFileSync(file, 'utf8');
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith(prefix));
  if (!line) throw new Error(`missing ${prefix} metrics in ${file}`);
  return JSON.parse(line.slice(prefix.length));
}

const args = process.argv.slice(2);
const [aFile, bFile] = args;
const reloadAFile = args[2] ?? '/tmp/reload-a.log', reloadBFile = args[3] ?? '/tmp/reload-b.log';
if (!aFile || !bFile) throw new Error('usage: checkSEG77RockSnowTerrain3DEvidence.mjs <run-a.log> <run-b.log> [reload-a.log reload-b.log]');
const importPrefix = 'G77_TERRAIN3D_ROCK_SNOW_METRICS=';
const reloadPrefix = 'G77_TERRAIN3D_ROCK_SNOW_RELOAD_METRICS=';
const a = parseMetrics(aFile, importPrefix), b = parseMetrics(bFile, importPrefix);
const ra = parseMetrics(reloadAFile, reloadPrefix), rb = parseMetrics(reloadBFile, reloadPrefix);
const exactKeys = ['regionCount', 'sampleCount', 'checksum', 'bakedSurfaces', 'bakedVertices', 'savedFiles', 'reloadRegionCount', 'reloadChecksum', 'reloadBakedSurfaces'];
const toleranceKeys = ['maxBlendError', 'maxHeightError', 'seamBlendError', 'seamHeightError'];
for (const key of exactKeys) if (a[key] !== b[key]) throw new Error(`Terrain3D semantic mismatch ${key}: ${a[key]} != ${b[key]}`);
for (const key of toleranceKeys) if (Math.abs(Number(a[key]) - Number(b[key])) > 1e-12) throw new Error(`Terrain3D numeric mismatch ${key}`);
const reloadExact = ['regionCount', 'alignedSamples', 'seamSamples', 'checksum', 'bakedSurfaces', 'bakedVertices'];
for (const key of reloadExact) if (ra[key] !== rb[key]) throw new Error(`cross-process reload mismatch ${key}: ${ra[key]} != ${rb[key]}`);
for (const key of toleranceKeys) if (Math.abs(Number(ra[key]) - Number(rb[key])) > 1e-12) throw new Error(`cross-process reload numeric mismatch ${key}`);
if (a.regionCount < 4 || a.sampleCount < 324 || a.reloadRegionCount < 4) throw new Error('Terrain3D multi-region/sample proof is too small');
if (a.bakedSurfaces < 1 || a.bakedVertices < 1 || a.reloadBakedSurfaces < 1) throw new Error('Terrain3D LOD0/reload bake evidence is empty');
if (a.savedFiles < 4 || a.savedBytes <= 0 || b.savedBytes <= 0) throw new Error('Terrain3D persistence evidence is empty');
if (ra.regionCount < 4 || ra.alignedSamples !== 4225 || ra.bakedSurfaces < 1 || ra.bakedVertices < 1) throw new Error('cross-process reload proof is incomplete');
if (a.checksum !== a.reloadChecksum || b.checksum !== b.reloadChecksum || ra.checksum !== rb.checksum) throw new Error('import/reload checksum parity failed');
for (const m of [a, b, ra, rb]) {
  if (m.maxBlendError > 0.006 || m.seamBlendError > 0.006) throw new Error('Terrain3D control roundtrip exceeded tolerance');
  if (m.maxHeightError > 0.00002 || m.seamHeightError > 0.00002) throw new Error('Terrain3D height roundtrip exceeded tolerance');
}
const metrics = { schema: 'se-g77-terrain3d-rock-snow-evidence-r10', semanticStable: true, runA: a, runB: b, reloadA: ra, reloadB: rb, persistenceBytesAreEvidenceOnly: true };
console.log(`SE_G77_ROCK_SNOW_TERRAIN3D_EVIDENCE=${JSON.stringify(metrics)}`);
console.log('SE_G77_ROCK_SNOW_TERRAIN3D_EVIDENCE_OK');
