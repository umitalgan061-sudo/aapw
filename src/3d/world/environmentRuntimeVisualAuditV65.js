const clamp = (v, min, max) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
const round = (v, p = 3) => Number((Number.isFinite(v) ? v : 0).toFixed(p));

export const V65_VISUAL_AUDIT_POLICY = Object.freeze({
  id: 'environment-runtime-visual-audit-v65-2026-09-14',
  cameras: Object.freeze(['world-full', 'terrain-near', 'far-mountain', 'water-edge', 'biome-ecotone']),
  p0: Object.freeze(['rectangular-water', 'moire', 'cyan-water', 'black-sky', 'terrain-seam']),
  p1: Object.freeze(['floating', 'interpenetration', 'lod-pop', 'placeholder', 'vegetation-drift']),
});

export const auditWater = (water = {}) => ({
  rectangular: water.rectangular === true,
  moire: water.moire === true,
  cyan: water.cyan === true,
  shoreBlend: clamp(water.shoreBlend ?? 0, 0, 1),
  foam: clamp(water.foam ?? 0, 0, 1),
});

export const auditGeometry = (geometry = {}) => ({
  floating: geometry.floating === true,
  interpenetration: geometry.interpenetration === true,
  placeholders: geometry.placeholders === true,
  lodPop: geometry.lodPop === true,
  vegetationDrift: geometry.vegetationDrift === true,
});

export const auditAtmosphere = (atmosphere = {}) => ({
  blackSky: atmosphere.blackSky === true,
  luma: clamp(atmosphere.luma ?? 0.55, 0, 1),
  visibility: clamp(atmosphere.visibility ?? 1, 0, 1),
  mountainReadability: clamp(atmosphere.mountainReadability ?? 0.8, 0, 1),
});

export const auditMaterial = (material = {}) => ({
  seam: material.seam === true,
  repeatedTile: material.repeatedTile === true,
  flatNormal: material.flatNormal === true,
  snowBandVisible: material.snowBandVisible !== false,
  roughnessContinuity: clamp(material.roughnessContinuity ?? 0.8, 0, 1),
});

export const scoreCamera = ({ water = {}, geometry = {}, atmosphere = {}, material = {}, biomeSeparation = 0.8 } = {}) => {
  const w = auditWater(water);
  const g = auditGeometry(geometry);
  const a = auditAtmosphere(atmosphere);
  const m = auditMaterial(material);
  const hardPenalty = [w.rectangular, w.moire, w.cyan, g.floating, g.interpenetration, a.blackSky, m.seam].filter(Boolean).length;
  const softPenalty = [g.placeholders, g.lodPop, g.vegetationDrift, m.repeatedTile, m.flatNormal].filter(Boolean).length;
  return {
    score: round(clamp(1 - hardPenalty * 0.25 - softPenalty * 0.08 + biomeSeparation * 0.12, 0, 1)),
    p0Pass: hardPenalty === 0,
    p1Pass: softPenalty === 0,
    water: w,
    geometry: g,
    atmosphere: a,
    material: m,
  };
};

export const buildVisualAudit = (cameraResults = []) => {
  const results = cameraResults.map((item) => ({ camera: item.camera || 'unknown', ...scoreCamera(item) }));
  const p0Pass = results.every((item) => item.p0Pass);
  const p1Pass = results.every((item) => item.p1Pass);
  const meanScore = results.reduce((sum, item) => sum + item.score, 0) / (results.length || 1);
  return {
    policy: V65_VISUAL_AUDIT_POLICY.id,
    results,
    p0Pass,
    p1Pass,
    meanScore: round(meanScore),
    evidenceReady: p0Pass && meanScore >= 0.72,
  };
};

export const compareVisualAudits = (before, after) => ({
  scoreDelta: round((after?.meanScore ?? 0) - (before?.meanScore ?? 0)),
  p0Before: before?.p0Pass ?? false,
  p0After: after?.p0Pass ?? false,
  p1Before: before?.p1Pass ?? false,
  p1After: after?.p1Pass ?? false,
});

export const validateVisualAudit = (audit) => {
  const errors = [];
  if (audit?.policy !== V65_VISUAL_AUDIT_POLICY.id) errors.push('policy');
  if (audit?.meanScore < 0 || audit?.meanScore > 1) errors.push('score-range');
  for (const result of audit?.results || []) if (typeof result.p0Pass !== 'boolean') errors.push('p0-state');
  return { ok: errors.length === 0, errors };
};

export const createCameraEvidence = (camera, metrics = {}) => ({
  camera,
  projection: 'orthographic',
  width: 1536,
  height: 1024,
  metrics: {
    readability: clamp(metrics.readability ?? 0.8, 0, 1),
    grounding: clamp(metrics.grounding ?? 0.8, 0, 1),
    biomeSeparation: clamp(metrics.biomeSeparation ?? 0.8, 0, 1),
    waterClarity: clamp(metrics.waterClarity ?? 0.8, 0, 1),
  },
});

export const auditEvidenceSet = (evidence = []) => {
  const valid = evidence.every((item) => item.projection === 'orthographic' && item.width === 1536 && item.height === 1024);
  const score = evidence.reduce((sum, item) => {
    const values = Object.values(item.metrics || {});
    return sum + values.reduce((a, b) => a + b, 0) / (values.length || 1);
  }, 0) / (evidence.length || 1);
  return { valid, evidenceScore: round(score), count: evidence.length };
};
