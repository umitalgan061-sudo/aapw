/** SW G17 continuous seabed substrate field. */
import { sampleG17WaterConfidence } from './g17_hydrology.mjs';
import {
  G17_RELIEF_POLICY,
  sampleG17SeabedHeight,
  sampleG17SeabedNormal,
} from './g17_relief.mjs';

export const G17_ROCK_SNOW_POLICY = Object.freeze({
  id: 'gunbatimi-ustasi-g17-terrain3d-rock-snow-2026-08-13-v1',
  sourceMapSha256: G17_RELIEF_POLICY.sourceMapSha256,
  geoCell: 'G17',
  gx: 1,
  gy: 7,
  layer: 'Rock/Snow',
  normalizedBounds: G17_RELIEF_POLICY.normalizedBounds,
  sourceGridSize: 65,
  terrain3dRegionSize: 256,
  terrain3dImportSize: 257,
  groundTextureId: 0,
  rockTextureId: 1,
  guardBandNormalized: 1 / 1536,
});

const clamp01 = (value) => Math.max(0, Math.min(1, value));
function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function seabedSlope(normal) {
  return clamp01(Math.hypot(normal[0], normal[2]) / Math.max(0.000001, normal[1]));
}
function substrateRipple(nx, ny) {
  const a = Math.sin((nx * 13.0 + ny * 8.0) * Math.PI);
  const b = Math.sin((nx * 6.0 - ny * 11.0) * Math.PI);
  return clamp01(0.5 + 0.33 * a + 0.17 * b);
}

export function sampleG17RockSnow(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const x = clamp01(normalizedX);
  const y = clamp01(normalizedY);
  const seabed = sampleG17SeabedHeight(x, y);
  const slope = seabedSlope(sampleG17SeabedNormal(x, y));
  const waterConfidence = sampleG17WaterConfidence(x, y);
  const deepSignal = 1 - smoothstep(
    G17_RELIEF_POLICY.deepSeabedMeters,
    G17_RELIEF_POLICY.waterCeilingMeters - 0.75,
    seabed.height,
  );
  const basinSignal = 1 - seabed.shelf;
  const slopeSignal = smoothstep(0.00018, 0.00070, slope);
  const ripple = substrateRipple(x, y);
  const sedimentSignal = clamp01(deepSignal * (1 - 0.75 * slopeSignal));
  const rockBlend = clamp01(
    0.14
      + 0.26 * slopeSignal
      + 0.18 * basinSignal
      + 0.08 * ripple
      - 0.18 * sedimentSignal,
  );
  return Object.freeze({
    waterConfidence,
    height: seabed.height,
    shelf: seabed.shelf,
    slope,
    deepSignal,
    basinSignal,
    slopeSignal,
    ripple,
    sedimentSignal,
    rockBlend,
    rockWeight: rockBlend,
    snowWeight: 0,
    groundWeight: 1 - rockBlend,
  });
}
