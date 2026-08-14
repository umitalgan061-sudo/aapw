#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.find((value) => value.startsWith('--out-dir='));
const out = path.resolve(ROOT, arg ? arg.slice(10) : 'artifacts/ne-g60-biome-visual');
const expected = new Map([
  ['near', [960, 640]],
  ['far', [960, 640]],
  ['full-world', [1200, 800]],
]);
const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const hashes = new Set();

for (const [kind, [width, height]] of expected) {
  const file = path.join(out, `g60-biome-${kind}.png`);
  const png = fs.readFileSync(file);
  if (png.length < 33 || !png.subarray(0, 8).equals(signature)) throw new Error(`${kind} is not a PNG`);
  if (png.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`${kind} PNG is missing IHDR`);
  const actual = [png.readUInt32BE(16), png.readUInt32BE(20)];
  if (actual[0] !== width || actual[1] !== height) throw new Error(`${kind} dimensions ${actual.join('x')} != ${width}x${height}`);
  hashes.add(crypto.createHash('sha256').update(png).digest('hex'));
}

if (hashes.size !== expected.size) throw new Error('near/far/full-world visual proofs must be distinct');
console.log(`NE_G60_BIOME_PNG_EVIDENCE_OK views=${hashes.size}`);
