import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const out = path.resolve(root, outArg ? outArg.slice('--out-dir='.length) : 'artifacts/se-g77-rock-snow-r9');
const files = {
  sourceProbe: 'godot/terrain-authoring/.terrain3d-proof/g77-rock-snow-probe.json',
  importedTerrain3D: 'godot/terrain-authoring/.terrain3d-proof/g77-rock-snow-imported-topdown.png',
  near: path.join(out, 'g77-rock-snow-near.png'),
  far: path.join(out, 'g77-rock-snow-far.png'),
  localTopdown: path.join(out, 'g77-rock-snow-topdown.png'),
  fullWorldTopdown: path.join(out, 'g77-rock-snow-full-world-topdown.png'),
};
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const pngSignature = Buffer.from([137,80,78,71,13,10,26,10]);
const pngDimensions = { importedTerrain3D:[257,257], near:[960,640], far:[960,640], localTopdown:[960,640], fullWorldTopdown:[1200,800] };
const evidence = {};
for (const [name, file] of Object.entries(files)) {
  const resolved = path.resolve(root, file);
  if (!fs.existsSync(resolved)) throw new Error(`missing G77 evidence: ${name}`);
  const bytes = fs.readFileSync(resolved);
  if (bytes.length < (name === 'sourceProbe' ? 1024 : 4096)) throw new Error(`undersized G77 evidence: ${name}=${bytes.length}`);
  if (name !== 'sourceProbe' && !bytes.subarray(0,8).equals(pngSignature)) throw new Error(`invalid PNG signature: ${name}`);
  if (name !== 'sourceProbe' && bytes.subarray(12,16).toString('ascii') !== 'IHDR') throw new Error(`missing PNG IHDR: ${name}`);
  if (name !== 'sourceProbe' && (bytes.readUInt32BE(16) !== pngDimensions[name][0] || bytes.readUInt32BE(20) !== pngDimensions[name][1])) throw new Error(`unexpected PNG dimensions: ${name}`);
  evidence[name] = { bytes: bytes.length, sha256: sha256(bytes) };
}
if (new Set(['near','far','localTopdown','fullWorldTopdown'].map((k) => evidence[k].sha256)).size !== 4) throw new Error('visual evidence frames are not distinct');
const probe = JSON.parse(fs.readFileSync(path.resolve(root, files.sourceProbe), 'utf8'));
if (probe.sourceMapSha256 !== '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1') throw new Error('manifest map.png provenance mismatch');
if (probe.policyId !== 'kizil-ufuk-g77-terrain3d-rock-snow-2026-08-14-r9' || probe.geoCell !== 'G77' || probe.layer !== 'Rock/Snow' || probe.terrain3dRegionSize !== 256 || probe.terrain3dImportSize !== 257) throw new Error('manifest source contract mismatch');
const manifest = { schema:'se-g77-rock-snow-evidence-r9', sourceMapSha256:probe.sourceMapSha256, geoCell:'G77', layer:'Rock/Snow', terrain3dImportSize:257, evidence };
fs.writeFileSync(path.join(out, 'g77-rock-snow-evidence-manifest.json'), `${JSON.stringify(manifest,null,2)}\n`);
console.log(`SE_G77_ROCK_SNOW_EVIDENCE_MANIFEST=${JSON.stringify(manifest)}`);
console.log('SE_G77_ROCK_SNOW_EVIDENCE_MANIFEST_OK');
