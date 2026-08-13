import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const PREFIX = 'G17_TERRAIN3D_RELIEF_GRID_METRICS=';
function need(ok, message) { if (!ok) throw new Error(`SW G17 grid evidence: ${message}`); }
function arg(name) { return process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3); }
function read(file) { need(file && fs.existsSync(file), `missing ${file || 'path'}`); return fs.readFileSync(file); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function metric(buffer) {
  const text = buffer.toString('utf8');
  need(text.includes('SW_G17_TERRAIN3D_RELIEF_GRID_OK'), 'grid success marker missing');
  const line = text.split(/\r?\n/).find((candidate) => candidate.startsWith(PREFIX));
  need(line, 'grid metrics missing');
  return JSON.parse(line.slice(PREFIX.length));
}

const logAPath = arg('log-a');
const logBPath = arg('log-b');
const probePath = arg('probe');
const outPath = arg('out');
const probeBytes = read(probePath);
const probe = JSON.parse(probeBytes.toString('utf8'));
const logA = read(logAPath);
const logB = read(logBPath);
const a = metric(logA);
const b = metric(logB);
need(JSON.stringify(a) === JSON.stringify(b), `grid metrics differ\nA=${JSON.stringify(a)}\nB=${JSON.stringify(b)}`);
need(a.samples === 257 * 257, 'full-grid sample count changed');
need(a.regionCount >= 4, 'full-grid region count regressed');
need(a.maxHeightError <= probe.proofContract.maxAlignedHeightErrorMeters, 'full-grid height error exceeds contract');
need(a.maxHeight < probe.waterCeilingMeters, 'full-grid marine ceiling violated');
need(a.maxHeight > a.minHeight, 'full-grid relief collapsed');
need(Number.isInteger(a.checksum), 'full-grid checksum missing');

const manifest = { policyId: probe.policyId, sourceMapSha256: probe.sourceMapSha256, probeSha256: sha256(probeBytes), gridMetrics: a, logASha256: sha256(logA), logBSha256: sha256(logB) };
need(outPath, '--out required');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`SW_G17_RELIEF_GRID_MANIFEST_SHA256=${sha256(fs.readFileSync(outPath))}`);
console.log('SW_G17_RELIEF_TERRAIN3D_GRID_EVIDENCE_OK');
