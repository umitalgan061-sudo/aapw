import fs from 'node:fs';

function parseMetrics(file) {
  const text = fs.readFileSync(file, 'utf8');
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith('G77_TERRAIN3D_ROCK_SNOW_METRICS='));
  if (!line) throw new Error(`missing Terrain3D metrics in ${file}`);
  return JSON.parse(line.slice('G77_TERRAIN3D_ROCK_SNOW_METRICS='.length));
}

const [aFile, bFile] = process.argv.slice(2);
if (!aFile || !bFile) throw new Error('usage: checkSEG77RockSnowTerrain3DEvidence.mjs <run-a.log> <run-b.log>');
const a = parseMetrics(aFile), b = parseMetrics(bFile);
const exactKeys = ['regionCount', 'sampleCount', 'checksum', 'bakedSurfaces', 'bakedVertices', 'savedFiles'];
const toleranceKeys = ['maxBlendError', 'maxHeightError', 'seamBlendError', 'seamHeightError'];
for (const key of exactKeys) if (a[key] !== b[key]) throw new Error(`Terrain3D semantic mismatch ${key}: ${a[key]} != ${b[key]}`);
for (const key of toleranceKeys) if (Math.abs(Number(a[key]) - Number(b[key])) > 1e-12) throw new Error(`Terrain3D numeric mismatch ${key}`);
if (a.regionCount < 4 || a.sampleCount < 324) throw new Error('Terrain3D multi-region/sample proof is too small');
if (a.bakedSurfaces < 1 || a.bakedVertices < 1) throw new Error('Terrain3D LOD0 bake evidence is empty');
if (a.savedFiles < 4 || a.savedBytes <= 0 || b.savedBytes <= 0) throw new Error('Terrain3D persistence evidence is empty');
if (a.maxBlendError > 0.006 || a.seamBlendError > 0.006) throw new Error('Terrain3D control roundtrip exceeded tolerance');
if (a.maxHeightError > 0.00002 || a.seamHeightError > 0.00002) throw new Error('Terrain3D height roundtrip exceeded tolerance');
const metrics = { schema: 'se-g77-terrain3d-rock-snow-evidence-r9', semanticStable: true, runA: a, runB: b, persistenceBytesAreEvidenceOnly: true };
console.log(`SE_G77_ROCK_SNOW_TERRAIN3D_EVIDENCE=${JSON.stringify(metrics)}`);
console.log('SE_G77_ROCK_SNOW_TERRAIN3D_EVIDENCE_OK');
