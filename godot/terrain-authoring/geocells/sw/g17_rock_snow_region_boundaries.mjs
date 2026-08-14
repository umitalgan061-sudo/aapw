import { buildG17RockSnowControlProbe } from './g17_rock_snow_control_probe.mjs';

export function measureG17RockSnowRegionBoundaries() {
  const probe = buildG17RockSnowControlProbe();
  const rows = probe.rows;
  let comparedPairs = 0;
  let maxBlendByteStep = 0;
  let maxHeightStep = 0;
  let maxTextureIdDrift = 0;
  let checksum = 2166136261;

  function compare(a, b) {
    const [baseA, overlayA, blendA, heightA] = a;
    const [baseB, overlayB, blendB, heightB] = b;
    maxTextureIdDrift = Math.max(maxTextureIdDrift, Math.abs(baseA - baseB), Math.abs(overlayA - overlayB));
    maxBlendByteStep = Math.max(maxBlendByteStep, Math.abs(blendA - blendB));
    maxHeightStep = Math.max(maxHeightStep, Math.abs(heightA - heightB));
    checksum = Math.imul((checksum ^ blendA) >>> 0, 16777619) >>> 0;
    checksum = Math.imul((checksum ^ blendB) >>> 0, 16777619) >>> 0;
    comparedPairs += 1;
  }

  for (let z = 0; z < probe.importSize; z += 1) compare(rows[z][255], rows[z][256]);
  for (let x = 0; x < probe.importSize; x += 1) compare(rows[255][x], rows[256][x]);

  const corner = Object.freeze({
    northwest: rows[255][255],
    northeast: rows[255][256],
    southwest: rows[256][255],
    southeast: rows[256][256],
  });

  return Object.freeze({
    schema: 'westeros-g17-rock-snow-region-boundary-evidence-v1',
    policyId: probe.policyId,
    regionSize: probe.regionSize,
    importSize: probe.importSize,
    expectedMinimumRegions: probe.expectedMinimumRegions,
    comparedPairs,
    maxBlendByteStep,
    maxNormalizedBlendStep: Number((maxBlendByteStep / 255).toFixed(10)),
    maxHeightStep: Number(maxHeightStep.toFixed(10)),
    maxTextureIdDrift,
    checksum,
    corner,
  });
}
