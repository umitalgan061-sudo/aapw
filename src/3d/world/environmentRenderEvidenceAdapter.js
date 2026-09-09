const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const positive = (value, fallback = 1) => Math.max(0.000001, finite(value, fallback));
const safeText = (value, fallback = '') => typeof value === 'string' ? value.trim() : fallback;
const bool = value => value === true;
const round = (value, digits = 6) => {
  const scale = 10 ** digits;
  return Math.round(finite(value, 0) * scale) / scale;
};

const stableObject = value => {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stableObject(value[key]);
    return out;
  }, {});
};

const hashString = input => {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const normalizeVector = (value, fallback = { x: 0, y: 1, z: 0 }) => {
  const x = finite(value?.x, fallback.x);
  const y = finite(value?.y, fallback.y);
  const z = finite(value?.z, fallback.z);
  const magnitude = Math.hypot(x, y, z);
  if (magnitude < 0.000001) return { ...fallback };
  return { x: x / magnitude, y: y / magnitude, z: z / magnitude };
};

const normalizeCamera = (camera = {}) => ({
  id: safeText(camera.id, 'camera'),
  projection: safeText(camera.projection, 'orthographic').toLowerCase(),
  width: Math.max(1, Math.round(finite(camera.width, 1536))),
  height: Math.max(1, Math.round(finite(camera.height, 1024))),
  fov: clamp(camera.fov, 1, 179),
  near: clamp(camera.near, 0.0001, 100000),
  far: clamp(camera.far, 1, 1000000),
  position: {
    x: round(camera.position?.x),
    y: round(camera.position?.y),
    z: round(camera.position?.z),
  },
  forward: normalizeVector(camera.forward),
  seed: safeText(camera.seed, 'environment-proof-v27'),
});

const normalizeSample = (sample = {}, index = 0) => ({
  id: safeText(sample.id, `sample-${String(index).padStart(3, '0')}`),
  coordinate: {
    x: round(sample.coordinate?.x),
    y: round(sample.coordinate?.y),
    z: round(sample.coordinate?.z),
  },
  canonical: {
    height: finite(sample.canonical?.height),
    slope: clamp(sample.canonical?.slope, 0, 1),
    moisture: clamp(sample.canonical?.moisture, 0, 1),
    waterDistance: Math.max(0, finite(sample.canonical?.waterDistance, 999999)),
    biome: safeText(sample.canonical?.biome, 'unknown').toLowerCase(),
    waterBody: safeText(sample.canonical?.waterBody, 'none').toLowerCase(),
    roadDistance: Math.max(0, finite(sample.canonical?.roadDistance, 999999)),
    settlementDistance: Math.max(0, finite(sample.canonical?.settlementDistance, 999999)),
  },
  rendered: {
    height: finite(sample.rendered?.height),
    luminance: clamp(sample.rendered?.luminance, 0, 1),
    cyanRatio: clamp(sample.rendered?.cyanRatio, 0, 1),
    tileBoundaryRisk: clamp(sample.rendered?.tileBoundaryRisk, 0, 1),
    moireRisk: clamp(sample.rendered?.moireRisk, 0, 1),
    blackSkyRisk: clamp(sample.rendered?.blackSkyRisk, 0, 1),
    placeholderRisk: clamp(sample.rendered?.placeholderRisk, 0, 1),
    textureRepeatRisk: clamp(sample.rendered?.textureRepeatRisk, 0, 1),
    vegetationVoidRisk: clamp(sample.rendered?.vegetationVoidRisk, 0, 1),
  },
  collider: {
    height: finite(sample.collider?.height),
    grounded: bool(sample.collider?.grounded),
    valid: sample.collider?.valid !== false,
  },
  environment: {
    normalEnergy: clamp(sample.environment?.normalEnergy, 0, 1),
    macroBreakup: clamp(sample.environment?.macroBreakup, 0, 1),
    microBreakup: clamp(sample.environment?.microBreakup, 0, 1),
    atmosphericDepth: clamp(sample.environment?.atmosphericDepth, 0, 1),
    exposure: clamp(sample.environment?.exposure, 0, 4),
  },
});

const classifySurface = sample => {
  const { canonical, rendered } = sample;
  if (canonical.waterBody !== 'none' || canonical.waterDistance < 2) return 'water';
  if (canonical.slope > 0.78) return 'cliff';
  if (canonical.height > 2200) return 'alpine';
  if (canonical.biome.includes('snow') || canonical.biome.includes('tundra')) return 'snow';
  if (canonical.biome.includes('forest') || canonical.biome.includes('wood')) return 'forest';
  if (canonical.biome.includes('wet') || canonical.moisture > 0.72) return 'wet-ground';
  if (rendered.placeholderRisk > 0.35) return 'placeholder-risk';
  return 'ground';
};

const heightDelta = sample => Math.abs(sample.rendered.height - sample.canonical.height);
const colliderDelta = sample => Math.abs(sample.collider.height - sample.canonical.height);

const evaluateSample = sample => {
  const surface = classifySurface(sample);
  const renderHeightDelta = heightDelta(sample);
  const groundHeightDelta = colliderDelta(sample);
  const risks = [];
  if (!sample.collider.valid || !sample.collider.grounded) risks.push('collider-invalid');
  if (renderHeightDelta > 1.5) risks.push('render-canonical-height-mismatch');
  if (groundHeightDelta > 1.5) risks.push('collider-canonical-height-mismatch');
  if (sample.rendered.tileBoundaryRisk > 0.15) risks.push('tile-boundary');
  if (sample.rendered.cyanRatio > 0.18) risks.push('cyan-water-block');
  if (sample.rendered.moireRisk > 0.15) risks.push('water-moire');
  if (sample.rendered.blackSkyRisk > 0.2 || sample.rendered.luminance < 0.035) risks.push('black-sky');
  if (sample.rendered.placeholderRisk > 0.1) risks.push('placeholder');
  if (sample.rendered.textureRepeatRisk > 0.2) risks.push('texture-repetition');
  if (sample.rendered.vegetationVoidRisk > 0.7 && surface === 'forest') risks.push('vegetation-void');
  if (surface === 'alpine' && sample.environment.macroBreakup < 0.35) risks.push('flat-alpine');
  if (surface === 'cliff' && sample.environment.normalEnergy < 0.28) risks.push('flat-cliff');
  if (surface === 'snow' && sample.environment.macroBreakup < 0.3) risks.push('flat-snow');
  const visualQuality = clamp(
    1
      - Math.min(1, renderHeightDelta / 4)
      - Math.min(1, groundHeightDelta / 4)
      - sample.rendered.tileBoundaryRisk * 0.8
      - sample.rendered.cyanRatio * 0.8
      - sample.rendered.moireRisk * 0.8
      - sample.rendered.blackSkyRisk * 0.8
      - sample.rendered.placeholderRisk * 0.8
      - sample.rendered.textureRepeatRisk * 0.6,
    0,
    1,
  );
  return {
    id: sample.id,
    surface,
    renderHeightDelta: round(renderHeightDelta),
    colliderHeightDelta: round(groundHeightDelta),
    visualQuality: round(visualQuality),
    risks,
    pass: risks.length === 0,
  };
};

const aggregate = evaluations => {
  const riskCounts = {};
  let passCount = 0;
  let totalQuality = 0;
  evaluations.forEach(evaluation => {
    if (evaluation.pass) passCount += 1;
    totalQuality += evaluation.visualQuality;
    evaluation.risks.forEach(risk => {
      riskCounts[risk] = (riskCounts[risk] || 0) + 1;
    });
  });
  const sampleCount = evaluations.length;
  return {
    sampleCount,
    passCount,
    failCount: sampleCount - passCount,
    passRate: sampleCount ? round(passCount / sampleCount) : 0,
    averageVisualQuality: sampleCount ? round(totalQuality / sampleCount) : 0,
    riskCounts: Object.keys(riskCounts).sort().reduce((out, key) => {
      out[key] = riskCounts[key];
      return out;
    }, {}),
  };
};

const buildCameraSet = cameras => {
  const defaults = [
    { id: 'full-world', projection: 'orthographic', width: 1536, height: 1024, seed: 'full-world' },
    { id: 'terrain-far', projection: 'perspective', width: 1536, height: 1024, seed: 'terrain-far' },
    { id: 'terrain-near-center', projection: 'perspective', width: 1536, height: 1024, seed: 'terrain-near-center' },
    { id: 'terrain-near-northwest', projection: 'perspective', width: 1536, height: 1024, seed: 'terrain-near-northwest' },
  ];
  const source = Array.isArray(cameras) && cameras.length ? cameras : defaults;
  return source.map(normalizeCamera).sort((a, b) => a.id.localeCompare(b.id));
};

const buildAcceptanceTargets = ({ summary, cameras }) => ({
  visibleGridSeam: 0,
  visibleRectangularWaterBlock: 0,
  visibleWaterMoire: 0,
  visibleBlackSky: 0,
  visiblePlaceholder: 0,
  visibleFloatingAsset: 0,
  visibleMaterialMismatch: 0,
  minimumPassRate: 1,
  minimumAverageVisualQuality: 0.88,
  requiredCameraCount: cameras.length,
  actualPassRate: summary.passRate,
  actualAverageVisualQuality: summary.averageVisualQuality,
});

const freezeDeep = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
};

export const createEnvironmentRenderEvidence = (input = {}) => {
  const cameras = buildCameraSet(input.cameras);
  const samples = (Array.isArray(input.samples) ? input.samples : [])
    .map(normalizeSample)
    .sort((a, b) => a.id.localeCompare(b.id));
  const evaluations = samples.map(evaluateSample);
  const summary = aggregate(evaluations);
  const targets = buildAcceptanceTargets({ summary, cameras });
  const payload = {
    version: 'environment-render-evidence-v27',
    deterministicSeed: safeText(input.seed, 'buzul-muhafizi-v27'),
    cameras,
    samples: evaluations,
    summary,
    acceptance: {
      ...targets,
      status: summary.passRate >= 1 && summary.averageVisualQuality >= 0.88 ? 'pass' : 'guarded',
    },
  };
  const canonical = JSON.stringify(stableObject(payload));
  return freezeDeep({
    ...payload,
    digest: hashString(canonical),
  });
};

export const serializeEnvironmentRenderEvidence = evidence => JSON.stringify(stableObject(evidence));

export const createBeforeAfterEnvironmentDelta = (before = {}, after = {}) => {
  const beforeSummary = before.summary || {};
  const afterSummary = after.summary || {};
  return freezeDeep({
    passRateDelta: round(finite(afterSummary.passRate) - finite(beforeSummary.passRate)),
    visualQualityDelta: round(finite(afterSummary.averageVisualQuality) - finite(beforeSummary.averageVisualQuality)),
    failCountDelta: Math.round(finite(afterSummary.failCount) - finite(beforeSummary.failCount)),
    riskCountsDelta: Object.keys({ ...(beforeSummary.riskCounts || {}), ...(afterSummary.riskCounts || {}) })
      .sort()
      .reduce((out, key) => {
        out[key] = Math.round(finite(afterSummary.riskCounts?.[key]) - finite(beforeSummary.riskCounts?.[key]));
        return out;
      }, {}),
  });
};

export default createEnvironmentRenderEvidence;
