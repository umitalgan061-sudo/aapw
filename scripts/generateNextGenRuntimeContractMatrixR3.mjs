#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';

const OUT = 'artifacts/next-gen-runtime-integration/runtime-contract.matrix';
const BACKENDS = ['webgpu', 'webgl2', 'webgl2-fallback', 'webgpu-requested-unavailable'];
const QUALITY = ['minimal', 'balanced', 'high', 'ultra'];
const DEVICES = ['desktop', 'laptop', 'tablet', 'phone'];
const LOADS = ['idle', 'normal', 'streaming', 'pressure'];
const SCENES = ['empty', 'settlement', 'forest', 'battle'];

function rank(value) { return QUALITY.indexOf(value); }
function bool(value) { return value === true; }
function clamp(value, low, high) { return Math.min(high, Math.max(low, Number(value) || low)); }
function expectedBackend(input) {
  return input.backend === 'webgpu' ? 'webgpu' : 'webgl2';
}
function deriveScale({ quality, device, load }) {
  let scale = 1;
  if (device === 'tablet') scale -= 0.08;
  if (device === 'phone') scale -= 0.18;
  if (load === 'streaming') scale -= 0.05;
  if (load === 'pressure') scale -= 0.18;
  if (rank(quality) === 0) scale -= 0.12;
  return Number(clamp(scale, 0.55, 1).toFixed(3));
}
function deriveEffects({ backend, quality, load, scene }) {
  const q = rank(quality);
  const modern = backend === 'webgpu';
  const pressure = load === 'pressure';
  return {
    taa: q >= 2 && !pressure,
    fxaa: q < 2,
    bloom: q >= 2 && !pressure,
    ssao: q >= 2 && scene !== 'empty' && !pressure,
    ssgi: modern && q >= 3 && !pressure,
    dof: modern && q >= 3 && !pressure,
    lut: q >= 1,
    vignette: q >= 1,
    fog: true,
  };
}
function deriveStreaming({ device, load, scene, quality }) {
  const phone = device === 'phone';
  const pressure = load === 'pressure';
  const base = phone ? 2 : device === 'tablet' ? 3 : 4;
  const concurrency = pressure ? Math.max(1, base - 2) : load === 'streaming' ? Math.max(1, base - 1) : base;
  const distance = scene === 'battle' ? 700 : scene === 'forest' ? 520 : scene === 'settlement' ? 420 : 300;
  const multiplier = quality === 'minimal' ? 0.7 : quality === 'ultra' ? 1.15 : 1;
  return { concurrency, maxDistanceMeters: Math.round(distance * multiplier), lookAheadSeconds: phone ? 1.35 : 2.25 };
}
function deriveMaterial({ backend, quality, load, scene }) {
  const q = rank(quality);
  const pressure = load === 'pressure';
  return {
    normalMap: q >= 1 && !pressure,
    aoMap: q >= 1 && scene !== 'empty' && !pressure,
    emissive: q >= 2 && !pressure,
    advancedLayering: backend === 'webgpu' && q >= 3 && !pressure,
    anisotropy: backend === 'webgpu' ? (q >= 2 ? 8 : 4) : (q >= 2 ? 4 : 2),
  };
}
function deriveExpected(row) {
  const effectiveBackend = expectedBackend(row);
  const effects = deriveEffects({ backend: effectiveBackend, quality: row.quality, load: row.load, scene: row.scene });
  const streaming = deriveStreaming(row);
  const material = deriveMaterial({ backend: effectiveBackend, quality: row.quality, load: row.load, scene: row.scene });
  return { effectiveBackend, scale: deriveScale(row), effects, streaming, material };
}

function makeCase(id, backend, quality, device, load, scene) {
  const row = { id, backend, quality, device, load, scene };
  const expected = deriveExpected(row);
  const pressure = load === 'pressure' ? 0.9 : load === 'streaming' ? 0.45 : load === 'normal' ? 0.12 : 0;
  const visibleObjects = scene === 'battle' ? 1800 : scene === 'forest' ? 1400 : scene === 'settlement' ? 900 : 120;
  const shadowCasters = Math.round(visibleObjects * (scene === 'battle' ? 0.18 : 0.12));
  const animatedObjects = scene === 'battle' ? 220 : scene === 'settlement' ? 80 : scene === 'forest' ? 32 : 4;
  const textureBytes = Math.round((visibleObjects * 16384) * (quality === 'ultra' ? 1.6 : quality === 'high' ? 1.2 : quality === 'balanced' ? 1 : 0.7));
  return [
    id,
    backend,
    quality,
    device,
    load,
    scene,
    expected.effectiveBackend,
    expected.scale,
    Number(pressure.toFixed(2)),
    visibleObjects,
    shadowCasters,
    animatedObjects,
    textureBytes,
    expected.effects.taa ? 1 : 0,
    expected.effects.fxaa ? 1 : 0,
    expected.effects.bloom ? 1 : 0,
    expected.effects.ssao ? 1 : 0,
    expected.effects.ssgi ? 1 : 0,
    expected.effects.dof ? 1 : 0,
    expected.effects.lut ? 1 : 0,
    expected.effects.vignette ? 1 : 0,
    expected.effects.fog ? 1 : 0,
    expected.streaming.concurrency,
    expected.streaming.maxDistanceMeters,
    expected.streaming.lookAheadSeconds,
    expected.material.normalMap ? 1 : 0,
    expected.material.aoMap ? 1 : 0,
    expected.material.emissive ? 1 : 0,
    expected.material.advancedLayering ? 1 : 0,
    expected.material.anisotropy,
  ].join('|');
}

function buildMatrix() {
  const rows = [];
  let id = 1;
  for (const backend of BACKENDS) {
    for (const quality of QUALITY) {
      for (const device of DEVICES) {
        for (const load of LOADS) {
          for (const scene of SCENES) {
            rows.push(makeCase(String(id).padStart(4, '0'), backend, quality, device, load, scene));
            id += 1;
          }
        }
      }
    }
  }
  return rows;
}

export function validateMatrixRows(rows) {
  if (rows.length !== 4096) throw new Error(`expected 4096 cases, got ${rows.length}`);
  const ids = new Set(rows.map((row) => row.split('|', 1)[0]));
  if (ids.size !== 4096) throw new Error(`expected 4096 unique ids, got ${ids.size}`);
  if (rows.some((row) => row.split('|').length !== 30)) throw new Error('every runtime contract row must have 30 fields');
  return true;
}

export async function main() {
  const rows = buildMatrix();
  validateMatrixRows(rows);
  const header = [
    '# AAPW next-gen runtime integration deterministic contract corpus R3',
    '# 4 backends x 4 quality tiers x 4 device classes x 4 load states x 4 scene classes = 4096 cases',
    '# fields=id|backend|quality|device|load|scene|effectiveBackend|scale|pressure|visible|shadows|animated|textureBytes|taa|fxaa|bloom|ssao|ssgi|dof|lut|vignette|fog|streamConcurrency|maxDistance|lookAhead|normalMap|aoMap|emissive|advancedLayering|anisotropy',
  ].join('\n');
  await mkdir('artifacts/next-gen-runtime-integration', { recursive: true });
  await writeFile(OUT, `${header}\n${rows.join('\n')}\n`, 'utf8');
  console.log(`wrote ${rows.length} runtime contract cases to ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
