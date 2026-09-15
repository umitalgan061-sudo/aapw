import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv.find((arg) => arg.startsWith('--out-dir='))?.split('=')[1] ?? path.join(ROOT, 'artifacts', 'world-coverage-visual-v52'));
const EXPECTED = ['full-world', 'terrain-near', 'northwest-near', 'mountain-near', 'coast-water', 'forest-ecotone'];
let checks = 0;
const check = (value, message) => { checks += 1; assert.ok(value, message); };

function decodePng(filePath) {
  const data = fs.readFileSync(filePath);
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  check(data.subarray(0, 8).equals(signature), `${filePath} PNG signature`);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const chunks = [];
  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); bitDepth = body[8]; colorType = body[9]; }
    if (type === 'IDAT') chunks.push(body);
    if (type === 'IEND') break;
  }
  check(width === 1536, `PNG width must be 1536: ${filePath}`);
  check(height === 1024, `PNG height must be 1024: ${filePath}`);
  check(bitDepth === 8, `PNG bit depth must be 8: ${filePath}`);
  check([2, 6].includes(colorType), `PNG color type must be RGB/RGBA: ${filePath}`);
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const channels = colorType === 6 ? 4 : 3;
  const rowBytes = width * channels;
  check(raw.length >= (rowBytes + 1) * height, `PNG scanline size: ${filePath}`);
  return { raw, width, height, channels, rowBytes };
}

function pixelStats(decoded) {
  const { raw, width, height, channels, rowBytes } = decoded;
  const stats = { cyan: 0, black: 0, neutral: 0, samples: 0 };
  let prev = null;
  for (let y = 0; y < height; y += 12) {
    const filter = raw[y * (rowBytes + 1)];
    check(filter === 0 || filter === 1 || filter === 2 || filter === 3 || filter === 4, 'PNG filter byte must be valid');
    if (filter !== 0) continue;
    const row = y * (rowBytes + 1) + 1;
    for (let x = 0; x < width; x += 12) {
      const index = row + x * channels;
      const r = raw[index]; const g = raw[index + 1]; const b = raw[index + 2];
      stats.samples += 1;
      if (g > r + 42 && b > r + 28 && g > 90) stats.cyan += 1;
      if (r < 8 && g < 8 && b < 8) stats.black += 1;
      if (Math.abs(r - g) < 3 && Math.abs(g - b) < 3) stats.neutral += 1;
      if (prev && Math.abs(r - prev.r) + Math.abs(g - prev.g) + Math.abs(b - prev.b) > 250) stats.edgeJumps = (stats.edgeJumps ?? 0) + 1;
      prev = { r, g, b };
    }
  }
  return stats;
}

const manifestPath = path.join(OUT, 'manifest.json');
if (!fs.existsSync(manifestPath)) throw new Error(`missing proof manifest: ${manifestPath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
check(manifest.policyId === 'world-coverage-visual-runtime-2026-09-10-v52', 'manifest policy id');
check(manifest.width === 1536 && manifest.height === 1024, 'manifest dimensions');
check(Array.isArray(manifest.samples), 'manifest samples array');
check(manifest.samples.length === EXPECTED.length, 'manifest sample count');

const resultById = new Map(manifest.samples.map((sample) => [sample.id, sample]));
const diagnostics = [];
for (const id of EXPECTED) {
  check(resultById.has(id), `sample missing: ${id}`);
  const sample = resultById.get(id);
  const relative = sample.screenshot;
  check(typeof relative === 'string', `sample screenshot path: ${id}`);
  const absolute = path.resolve(ROOT, relative);
  check(fs.existsSync(absolute), `sample PNG missing: ${id}`);
  if (!fs.existsSync(absolute)) continue;
  const decoded = decodePng(absolute);
  const stats = pixelStats(decoded);
  diagnostics.push({ id, bytes: fs.statSync(absolute).size, stats });
  check(stats.samples > 1000, `enough pixel samples for ${id}`);
  check(stats.black < stats.samples * 0.80, `black-sky failure too dominant for ${id}`);
  check(stats.cyan < stats.samples * 0.55, `cyan-water failure too dominant for ${id}`);
  check(stats.neutral < stats.samples * 0.92, `flat-neutral failure too dominant for ${id}`);
}

check(Array.isArray(manifest.consoleErrors), 'console error array');
check(Array.isArray(manifest.pageErrors), 'page error array');
check(manifest.consoleErrors.length === 0, 'proof capture must have zero console errors');
check(manifest.pageErrors.length === 0, 'proof capture must have zero page errors');
fs.writeFileSync(path.join(OUT, 'evidence-check.json'), JSON.stringify({ policyId: manifest.policyId, diagnostics, checks }, null, 2));
console.log(`WORLD_COVERAGE_VISUAL_RUNTIME_V52_EVIDENCE_OK checks=${checks} samples=${diagnostics.length}`);
