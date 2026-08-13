/**
 * Günbatımı Ustası / SW GeoCell G17 Relief/Height Character.
 * G17 is canonical open sea. GeoCell coordinates are addressing only; the relief
 * field is evaluated in global owner-map space so it remains continuous through
 * G07/G17/G27 guard bands and cannot stamp a visible square tile.
 */
import { REFERENCE_WATER_ZONES, sampleReferenceInfluence } from '../../../../src/3d/world/worldReferenceMap.js';
import { sampleReferenceWaterMask } from '../../../../src/3d/world/worldReferenceWaterMask.js';

export const G17_RELIEF_POLICY = Object.freeze({
  id: 'gunbatimi-ustasi-g17-terrain3d-relief-2026-08-13-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G17', gx: 1, gy: 7, layer: 'Relief/Height Character',
  pixelBounds: Object.freeze({ xMin: 192, xMax: 384, yMin: 896, yMax: 1024 }),
  normalizedBounds: Object.freeze({ xMin: 0.125, xMax: 0.25, yMin: 0.875, yMax: 1 }),
  terrain3dRegionSize: 256,
  terrain3dImportSize: 257,
  guardBandNormalized: 1 / 96,
  referenceWorldMeters: Object.freeze({ x: 13296.079, z: 10341.395 }),
  waterCeilingMeters: -2.5,
  deepSeabedMeters: -9.4,
  shelfRiseMeters: 4.0,
});

const clamp01 = (v) => Math.max(0, Math.min(1, v));
function smoothstep(a, b, v) { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); }
function waterInfluence(x, y, id) {
  const zone = REFERENCE_WATER_ZONES.find((candidate) => candidate.id === id);
  return zone ? sampleReferenceInfluence(x, y, zone) : 0;
}

export function sampleG17SeabedHeight(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
  const x = clamp01(normalizedX); const y = clamp01(normalizedY);
  const sunset = waterInfluence(x, y, 'sunset-sea');
  const summer = waterInfluence(x, y, 'summer-sea');
  const southShelf = smoothstep(0.80, 1.0, y);
  const westShelf = 1 - smoothstep(0.04, 0.34, x);
  const broadShelf = clamp01(0.48 * sunset + 0.12 * summer + 0.24 * southShelf + 0.16 * westShelf);
  const longWave = 0.18 * Math.sin((x * 3.7 + y * 2.1) * Math.PI) + 0.10 * Math.sin((x * 7.1 - y * 3.3) * Math.PI);
  const height = Math.min(G17_RELIEF_POLICY.waterCeilingMeters - 0.35,
    G17_RELIEF_POLICY.deepSeabedMeters + G17_RELIEF_POLICY.shelfRiseMeters * broadShelf + longWave);
  return Object.freeze({ height, shelf: broadShelf, sunsetInfluence: sunset, summerInfluence: summer });
}

export function sampleG17SeabedNormal(x, y) {
  const e = 1 / 1536;
  const l = sampleG17SeabedHeight(x - e, y).height, r = sampleG17SeabedHeight(x + e, y).height;
  const d = sampleG17SeabedHeight(x, y - e).height, u = sampleG17SeabedHeight(x, y + e).height;
  let nx = -(r - l) / (2 * e * G17_RELIEF_POLICY.referenceWorldMeters.x);
  let ny = 1;
  let nz = -(u - d) / (2 * e * G17_RELIEF_POLICY.referenceWorldMeters.z);
  const len = Math.hypot(nx, ny, nz) || 1;
  return Object.freeze([nx / len, ny / len, nz / len]);
}

const normalDistance = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);

export function measureG17Relief() {
  const b = G17_RELIEF_POLICY.normalizedBounds, n = 64, rows = [];
  let canonicalWater = 0, canonicalLand = 0, minHeight = Infinity, maxHeight = -Infinity, checksum = 2166136261;
  for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 12; cx++) {
    const nx = (12 + cx + 0.5) / 96, ny = (56 + cy + 0.5) / 64;
    if (sampleReferenceWaterMask(nx, ny)) canonicalWater++; else canonicalLand++;
  }
  for (let sy = 0; sy <= n; sy++) {
    const row = [];
    for (let sx = 0; sx <= n; sx++) {
      const x = b.xMin + (b.xMax-b.xMin)*(sx/n), y = b.yMin + (b.yMax-b.yMin)*(sy/n);
      const h = sampleG17SeabedHeight(x,y).height; row.push(h); minHeight=Math.min(minHeight,h); maxHeight=Math.max(maxHeight,h);
      checksum ^= Math.round((h+16)*100000); checksum = Math.imul(checksum,16777619)>>>0;
    }
    rows.push(row);
  }
  let maxAdjacentHeightDelta = 0;
  for (let y=0;y<rows.length;y++) for (let x=0;x<rows[y].length;x++) {
    if (x+1<rows[y].length) maxAdjacentHeightDelta=Math.max(maxAdjacentHeightDelta,Math.abs(rows[y][x+1]-rows[y][x]));
    if (y+1<rows.length) maxAdjacentHeightDelta=Math.max(maxAdjacentHeightDelta,Math.abs(rows[y+1][x]-rows[y][x]));
  }
  let maxGuardBandHeightDelta=0,maxGuardBandNormalDelta=0; const g=G17_RELIEF_POLICY.guardBandNormalized;
  for (let i=0;i<=32;i++) {
    const t=i/32, x=b.xMin+(b.xMax-b.xMin)*t, y=b.yMin+(b.yMax-b.yMin)*t;
    for (const [ax,ay,bx,by] of [[b.xMin-g,y,b.xMin,y],[b.xMax,y,b.xMax+g,y],[x,b.yMin-g,x,b.yMin]]) {
      maxGuardBandHeightDelta=Math.max(maxGuardBandHeightDelta,Math.abs(sampleG17SeabedHeight(ax,ay).height-sampleG17SeabedHeight(bx,by).height));
      maxGuardBandNormalDelta=Math.max(maxGuardBandNormalDelta,normalDistance(sampleG17SeabedNormal(ax,ay),sampleG17SeabedNormal(bx,by)));
    }
  }
  return Object.freeze({policyId:G17_RELIEF_POLICY.id,geoCell:'G17',layer:G17_RELIEF_POLICY.layer,canonicalWater,canonicalLand,samples:4225,
    minHeight:+minHeight.toFixed(8),maxHeight:+maxHeight.toFixed(8),heightSpan:+(maxHeight-minHeight).toFixed(8),
    maxAdjacentHeightDelta:+maxAdjacentHeightDelta.toFixed(8),maxGuardBandHeightDelta:+maxGuardBandHeightDelta.toFixed(8),
    maxGuardBandNormalDelta:+maxGuardBandNormalDelta.toFixed(8),heightChecksum:checksum});
}

export function buildG17ReliefProbe(gridSize=65) {
  if (!Number.isInteger(gridSize)||gridSize<2) throw new RangeError('gridSize must be integer >=2');
  const b=G17_RELIEF_POLICY.normalizedBounds, rows=[];
  for(let y=0;y<gridSize;y++){const row=[];for(let x=0;x<gridSize;x++)row.push(+sampleG17SeabedHeight(b.xMin+(b.xMax-b.xMin)*x/(gridSize-1),b.yMin+(b.yMax-b.yMin)*y/(gridSize-1)).height.toFixed(8));rows.push(row);}
  return Object.freeze({policyId:G17_RELIEF_POLICY.id,sourceMapSha256:G17_RELIEF_POLICY.sourceMapSha256,terrain3dRegionSize:256,terrain3dImportSize:257,sourceGridSize:gridSize,normalizedBounds:b,waterCeilingMeters:G17_RELIEF_POLICY.waterCeilingMeters,rows});
}
