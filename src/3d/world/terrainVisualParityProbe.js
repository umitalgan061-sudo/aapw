const DEFAULT_TOLERANCE = 0.08;
const MAX_SAMPLES = 256;

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizePoint(point) {
  return {
    x: finite(point?.x),
    y: finite(point?.y),
    z: finite(point?.z),
  };
}

function stableSortSamples(samples) {
  return [...samples]
    .map((sample, index) => ({
      ...sample,
      index,
      point: normalizePoint(sample?.point),
      canonicalHeight: finite(sample?.canonicalHeight),
      renderedHeight: finite(sample?.renderedHeight),
      colliderHeight: finite(sample?.colliderHeight),
      slope: clamp(finite(sample?.slope), 0, 1),
      water: clamp(finite(sample?.water), 0, 1),
    }))
    .sort((a, b) => a.point.x - b.point.x || a.point.z - b.point.z || a.index - b.index);
}

function classify(sample, tolerance) {
  const renderedError = Math.abs(sample.renderedHeight - sample.canonicalHeight);
  const colliderError = Math.abs(sample.colliderHeight - sample.canonicalHeight);
  const renderColliderGap = Math.abs(sample.renderedHeight - sample.colliderHeight);
  const waterGuard = sample.water > 0.72;
  const steepGuard = sample.slope > 0.88;
  const structuralRisk = Math.max(renderedError, colliderError, renderColliderGap) > tolerance;
  return {
    renderedError,
    colliderError,
    renderColliderGap,
    waterGuard,
    steepGuard,
    structuralRisk,
    status: structuralRisk ? 'mismatch' : 'aligned',
  };
}

export function probeTerrainVisualParity(input = {}) {
  const tolerance = clamp(finite(input.tolerance, DEFAULT_TOLERANCE), 0.001, 2);
  const sourceSamples = Array.isArray(input.samples) ? input.samples.slice(0, MAX_SAMPLES) : [];
  const samples = stableSortSamples(sourceSamples);
  const measurements = samples.map((sample) => ({
    point: sample.point,
    canonicalHeight: sample.canonicalHeight,
    renderedHeight: sample.renderedHeight,
    colliderHeight: sample.colliderHeight,
    slope: sample.slope,
    water: sample.water,
    ...classify(sample, tolerance),
  }));

  const mismatchCount = measurements.filter((measurement) => measurement.structuralRisk).length;
  const waterMismatchCount = measurements.filter(
    (measurement) => measurement.waterGuard && measurement.structuralRisk,
  ).length;
  const steepMismatchCount = measurements.filter(
    (measurement) => measurement.steepGuard && measurement.structuralRisk,
  ).length;
  const maxRenderedError = measurements.reduce(
    (max, measurement) => Math.max(max, measurement.renderedError),
    0,
  );
  const maxColliderError = measurements.reduce(
    (max, measurement) => Math.max(max, measurement.colliderError),
    0,
  );
  const maxRenderColliderGap = measurements.reduce(
    (max, measurement) => Math.max(max, measurement.renderColliderGap),
    0,
  );

  const risk = mismatchCount === 0 ? 'clear' : waterMismatchCount > 0 || steepMismatchCount > 0 ? 'guarded' : 'review';

  return Object.freeze({
    contract: 'buzul-muhafizi.terrain-visual-parity.v22',
    tolerance,
    sampleCount: measurements.length,
    mismatchCount,
    waterMismatchCount,
    steepMismatchCount,
    maxRenderedError,
    maxColliderError,
    maxRenderColliderGap,
    risk,
    acceptance: {
      visibleTerrainMismatch: mismatchCount === 0,
      shorelineParity: waterMismatchCount === 0,
      steepReliefParity: steepMismatchCount === 0,
    },
    samples: Object.freeze(measurements.map((measurement) => Object.freeze(measurement))),
  });
}

export function serializeTerrainVisualParity(result) {
  return JSON.stringify(result ?? {});
}
