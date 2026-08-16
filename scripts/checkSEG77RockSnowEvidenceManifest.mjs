import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const arg = process.argv.find((v) => v.startsWith('--out-dir='));
const out = path.resolve(root, arg ? arg.slice(10) : 'artifacts/se-g77-rock-snow-visual');
const files = { probe: 'godot/terrain-authoring/.terrain3d-proof/g77-rock-snow-probe.json', imported: 'godot/terrain-authoring/.terrain3d-proof/g77-rock-snow-imported-topdown.png', near: path.join(out, 'g77-rock-snow-near.png'), far: path.join(out, 'g77-rock-snow-far.png'), fullWorld: path.join(out, 'g77-rock-snow-full-world.png'), visual: path.join(out, 'g77-rock-snow-visual-metrics.json') };
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const pngDimensions = (bytes) => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};
const evidence = {};
for (const [name, file] of Object.entries(files)) {
  const bytes = fs.readFileSync(path.resolve(root, file));
  if (name === 'probe' || name === 'visual') {
    if (bytes.length < 256) throw new Error(`undersized G77 evidence: ${name}`);
    evidence[name] = { bytes: bytes.length, sha256: sha256(bytes) };
    continue;
  }
  const dimensions = pngDimensions(bytes);
  if (!dimensions) throw new Error(`invalid PNG evidence: ${name}`);
  const expected = name === 'imported' ? { width: 257, height: 257 } : { width: 1536, height: 1024 };
  if (dimensions.width !== expected.width || dimensions.height !== expected.height) throw new Error(`unexpected PNG dimensions for ${name}: ${dimensions.width}x${dimensions.height}`);
  evidence[name] = { bytes: bytes.length, sha256: sha256(bytes), ...dimensions };
}
const probe = JSON.parse(fs.readFileSync(path.resolve(root, files.probe), 'utf8'));
const visual = JSON.parse(fs.readFileSync(path.resolve(root, files.visual), 'utf8'));
if (probe.sourceMapSha256 !== '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1' || probe.sourceMapVersion !== 'map.png-r1') throw new Error('source SHA/version provenance mismatch');
if (probe.sourceProvenance?.mode !== 'merged-sha-bound-derived-inputs' || probe.sourceProvenance?.rawPixelEvidenceClaimed !== false) throw new Error('raw-pixel provenance claim drifted');
if (visual.runtime?.fullOwnerMapCoverage !== true || visual.runtime?.targetRayHit !== true || visual.runtime?.renderPhysicsErrorMeters > 0.75 || visual.runtime?.visibleGeoCellOverlay !== false) throw new Error('real runtime evidence contract mismatch');
if (visual.runtime?.terrain3dRuntimeAdoptionClaimed !== false || visual.runtime?.rawPixelEvidenceClaimed !== false || visual.browserErrors?.length) throw new Error('evidence claim boundary drifted');
if (new Set([evidence.near.sha256, evidence.far.sha256, evidence.fullWorld.sha256]).size !== 3) throw new Error('runtime frames are not distinct');
const manifest = { schema: 'se-g77-rock-snow-evidence-v1', geoCell: 'G77', layer: 'Rock/Snow', sourceProvenanceMode: probe.sourceProvenance.mode, rawPixelEvidenceClaimed: false, terrain3dRuntimeAdoptionClaimed: false, evidence };
fs.writeFileSync(path.join(out, 'g77-rock-snow-evidence-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`SE_G77_ROCK_SNOW_EVIDENCE_MANIFEST=${JSON.stringify(manifest)}`);
console.log('SE_G77_ROCK_SNOW_EVIDENCE_MANIFEST_OK');