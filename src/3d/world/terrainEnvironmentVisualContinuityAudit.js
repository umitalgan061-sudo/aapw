const freeze = (value) => Object.freeze(value);
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const TERRAIN_ENVIRONMENT_VISUAL_CONTINUITY_AUDIT_POLICY = freeze({
  id: 'terrain-environment-visual-continuity-audit-2026-09-08-v1',
  deterministic: true,
  worldSpace: true,
  canonicalTerrainAuthority: 'src/3d/world/terrain.js',
  canonicalWaterAuthority: 'src/3d/world/water.js',
  noGeometryMutation: true,
  visibleArtifactTargets: freeze({ grid: 0, seam: 0, rectangularWater: 0, moire: 0, blackSky: 0 }),
});

function normalize(sample = {}) {
  return {
    worldX: finite(sample.worldX),
    worldZ: finite(sample.worldZ),
    heightMeters: finite(sample.heightMeters),
    slopeDegrees: clamp(finite(sample.slopeDegrees), 0, 90),
    waterDepth: Math.max(0, finite(sample.waterDepth)),
    waterConfidence: clamp(finite(sample.waterConfidence)),
    shorelineDistanceMeters: Math.max(0, finite(sample.shorelineDistanceMeters)),
    surfaceContrast: clamp(finite(sample.surfaceContrast)),
    macroBreakup: clamp(finite(sample.macroBreakup)),
    microBreakup: clamp(finite(sample.microBreakup)),
    normalEnergy: clamp(finite(sample.normalEnergy)),
    backgroundLuma: clamp(finite(sample.backgroundLuma)),
    tileRisk: clamp(finite(sample.tileRisk)),
    category: String(sample.category ?? ''),
  };
}

function artifactScore(a, b, threshold = 0.08) {
  const deltas = [
    Math.abs(a.heightMeters - b.heightMeters),
    Math.abs(a.surfaceContrast - b.surfaceContrast),
    Math.abs(a.macroBreakup - b.macroBreakup),
    Math.abs(a.microBreakup - b.microBreakup),
    Math.abs(a.normalEnergy - b.normalEnergy),
  ];
  return deltas.some((delta) => delta > threshold) ? 1 : 0;
}

export function auditVisualContinuity({ samples = [], pairThreshold = 0.08, expectedSampleCount = 0 } = {}) {
  const normalized = samples.map(normalize);
  let seamCount = 0;
  let gridCount = 0;
  let rectangularWaterCount = 0;
  let moireCount = 0;
  let blackSkyCount = 0;
  let maxAdjacentDelta = 0;
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    const delta = Math.max(
      Math.abs(previous.surfaceContrast - current.surfaceContrast),
      Math.abs(previous.macroBreakup - current.macroBreakup),
      Math.abs(previous.microBreakup - current.microBreakup),
      Math.abs(previous.normalEnergy - current.normalEnergy),
    );
    maxAdjacentDelta = Math.max(maxAdjacentDelta, delta);
    const score = artifactScore(previous, current, pairThreshold);
    seamCount += score;
    gridCount += score && previous.category !== current.category ? 1 : 0;
    moireCount += previous.tileRisk >= 0.8 && current.tileRisk >= 0.8 ? 1 : 0;
  }
  for (const sample of normalized) {
    rectangularWaterCount += sample.waterConfidence > 0.95 && sample.waterDepth > 0 && sample.shorelineDistanceMeters > 180 ? 1 : 0;
    blackSkyCount += sample.backgroundLuma < 0.04 ? 1 : 0;
  }
  const expected = Math.max(0, Math.floor(finite(expectedSampleCount)));
  const countMismatch = expected > 0 && normalized.length !== expected;
  const errors = [];
  if (countMismatch) errors.push('sample-count-mismatch');
  if (seamCount > 0) errors.push('visible-seam-risk');
  if (gridCount > 0) errors.push('visible-grid-risk');
  if (rectangularWaterCount > 0) errors.push('rectangular-water-risk');
  if (moireCount > 0) errors.push('water-moire-risk');
  if (blackSkyCount > 0) errors.push('black-sky-risk');
  return freeze({
    policyId: TERRAIN_ENVIRONMENT_VISUAL_CONTINUITY_AUDIT_POLICY.id,
    sampleCount: normalized.length,
    maxAdjacentDelta,
    errors: freeze(errors),
    counts: freeze({ seamCount, gridCount, rectangularWaterCount, moireCount, blackSkyCount }),
    acceptance: freeze({ ok: errors.length === 0, errorCount: errors.length }),
    samples: freeze(normalized.map((sample) => freeze(sample))),
  });
}

export function buildVisualContinuityManifest({ samples = [], camera = {}, seed = 'default' } = {}) {
  const audit = auditVisualContinuity({ samples });
  return freeze({
    version: 1,
    policyId: TERRAIN_ENVIRONMENT_VISUAL_CONTINUITY_AUDIT_POLICY.id,
    seed: String(seed),
    camera: freeze({
      projection: String(camera.projection ?? 'orthographic'),
      width: Math.max(1, Math.floor(finite(camera.width, 1536))),
      height: Math.max(1, Math.floor(finite(camera.height, 1024))),
      fovDegrees: Math.max(1, Math.min(179, finite(camera.fovDegrees, 90))),
    }),
    audit,
  });
}
