export const G17_ROAD_PATH_POLICY = Object.freeze({
  id: 'gunbatimi-ustasi-g17-terrain3d-road-path-2026-08-14-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G17', gx: 1, gy: 7, layer: 'Road/Path',
  normalizedBounds: Object.freeze({ xMin: 1 / 8, xMax: 2 / 8, yMin: 7 / 8, yMax: 1 }),
  guardBandNormalized: 1 / 1536,
  roadTextureId: 2, pathTextureId: 3,
});
export function sampleG17RoadPath(x, y) {
  const b = G17_ROAD_PATH_POLICY.normalizedBounds;
  const inside = x >= b.xMin && x <= b.xMax && y >= b.yMin && y <= b.yMax;
  return Object.freeze({ inside, roadCoverage: 0, pathCoverage: 0, coverage: 0 });
}
