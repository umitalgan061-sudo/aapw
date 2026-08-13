import { buildG17RockSnowProbe } from './g17_rock_snow_probe.mjs';

function interpolate(rows, channel, u, v) {
  const gx = Math.max(0, Math.min(1, u)) * 64;
  const gy = Math.max(0, Math.min(1, v)) * 64;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(64, x0 + 1), y1 = Math.min(64, y0 + 1);
  const tx = gx - x0, ty = gy - y0;
  const a = rows[y0][x0][channel], b = rows[y0][x1][channel];
  const c = rows[y1][x0][channel], d = rows[y1][x1][channel];
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
}

export function measureG17RockFullGrid() {
  const rows = buildG17RockSnowProbe().rows;
  const levels = new Set();
  let samples = 0, aligned = 0, maxRockErr = 0, maxHeightErr = 0, maxSnow = 0;
  let minRock = Infinity, maxRock = -Infinity, maxStep = 0, seamStep = 0, checksum = 2166136261;
  let previousRow = null;
  for (let z = 0; z < 257; z += 1) {
    const row = [];
    for (let x = 0; x < 257; x += 1) {
      const u = x / 256, v = z / 256;
      const rock = interpolate(rows, 3, u, v), height = interpolate(rows, 4, u, v), snow = interpolate(rows, 2, u, v);
      if (![rock, height, snow].every(Number.isFinite)) throw new Error('non-finite G17 Rock/Snow full-grid sample');
      minRock = Math.min(minRock, rock); maxRock = Math.max(maxRock, rock); maxSnow = Math.max(maxSnow, snow);
      if (x > 0) maxStep = Math.max(maxStep, Math.abs(rock - row[x - 1]));
      if (previousRow) maxStep = Math.max(maxStep, Math.abs(rock - previousRow[x]));
      if (x === 256) seamStep = Math.max(seamStep, Math.abs(rock - row[255]));
      if (z === 256 && previousRow) seamStep = Math.max(seamStep, Math.abs(rock - previousRow[x]));
      if (x % 4 === 0 && z % 4 === 0) {
        const source = rows[z / 4][x / 4];
        maxRockErr = Math.max(maxRockErr, Math.abs(rock - source[3]));
        maxHeightErr = Math.max(maxHeightErr, Math.abs(height - source[4]));
        aligned += 1;
      }
      const quantized = Math.round(Math.max(0, Math.min(1, rock)) * 255);
      levels.add(quantized); checksum = Math.imul((checksum ^ quantized) >>> 0, 16777619) >>> 0;
      row.push(rock); samples += 1;
    }
    previousRow = row;
  }
  return Object.freeze({ samples, aligned, maxRockErr, maxHeightErr, maxSnow,
    minRock: +minRock.toFixed(8), maxRock: +maxRock.toFixed(8), maxStep: +maxStep.toFixed(8),
    seamStep: +seamStep.toFixed(8), quantizedBlendLevels: levels.size, checksum });
}
