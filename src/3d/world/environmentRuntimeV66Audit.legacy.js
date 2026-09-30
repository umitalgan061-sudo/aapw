const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));

export const V66_AUDIT_POLICY = Object.freeze({
  id: 'environment-runtime-v66-audit-2026-09-15',
  version: 66,
  deterministic: true,
  p0: ['black-sky', 'cyan-water', 'rectangular-water', 'floating'],
  p1: ['seam', 'placeholder', 'unreadable-biome', 'unsafe-traversal'],
});

export const auditSkyV66 = (sky = {}) => ({
  pass: Number(sky.skyLumaFloor ?? 0) >= 0.08,
  blackSky: Number(sky.skyLumaFloor ?? 0) < 0.08,
  lumaFloor: clamp(sky.skyLumaFloor ?? 0),
});

export const auditWaterV66 = (water = {}, wetEdges = []) => {
  const corridor = water.corridor || [];
  const invalid = corridor.filter((item) => item.width < 2 || item.velocity < 0 || Number.isNaN(item.foam));
  const highFoam = corridor.filter((item) => item.foam > 0.95).length;
  const cyanRisk = wetEdges.filter((item) => (item.mud || 0) > 0.98 && (item.riparian || 0) < 0.02).length;
  return { pass: invalid.length === 0 && cyanRisk === 0, invalidCount: invalid.length, highFoam, cyanRisk };
};

export const auditNavigationV66 = (navigation = {}) => ({
  pass: (navigation.blockedRatio ?? 1) < 0.93,
  blockedRatio: clamp(navigation.blockedRatio ?? 1),
  meanRisk: clamp(navigation.meanRisk ?? 1),
});

export const auditEcologyV66 = (ecology = {}) => {
  const invalid = (ecology.layers || []).filter((layer) => {
    const total = Object.values(layer.weights || {}).reduce((sum, value) => sum + value, 0);
    return Math.abs(total - 1) > 0.03;
  });
  return { pass: invalid.length === 0, invalidLayers: invalid.length, sampleCount: ecology.count || 0 };
};

export const auditEventsV66 = (events = {}) => ({
  pass: Array.isArray(events.events) && events.events.length <= 48,
  queue: events.events?.length || 0,
  deterministic: events.deterministic === true,
});

export const auditEnvironmentV66 = (runtime = {}) => {
  const sky = auditSkyV66(runtime.sky);
  const water = auditWaterV66(runtime.water, runtime.wetEdges);
  const navigation = auditNavigationV66(runtime.navigation);
  const ecology = auditEcologyV66(runtime.ecology);
  const events = auditEventsV66(runtime.eventsRuntime || { events: [], deterministic: true });
  const p0 = {
    blackSky: sky.pass,
    water: water.pass,
    floating: runtime.scenario?.stability?.stability >= 0,
    mutation: runtime.contract?.noWorldMutation === true,
  };
  const p1 = {
    navigation: navigation.pass,
    ecology: ecology.pass,
    events: events.pass,
    digest: typeof runtime.digest === 'string' && runtime.digest.length === 8,
  };
  const p0Pass = Object.values(p0).every(Boolean);
  const p1Pass = Object.values(p1).every(Boolean);
  return {
    policy: V66_AUDIT_POLICY.id,
    p0,
    p1,
    p0Pass,
    p1Pass,
    pass: p0Pass && p1Pass,
    scores: {
      sky: sky.pass ? 1 : 0,
      water: water.pass ? 1 : 0,
      navigation: navigation.pass ? 1 : 0,
      ecology: ecology.pass ? 1 : 0,
    },
  };
};

export const compareEnvironmentAuditsV66 = (before, after) => ({
  before: auditEnvironmentV66(before),
  after: auditEnvironmentV66(after),
  improved: Number(after?.digest || '') !== Number(before?.digest || '') && auditEnvironmentV66(after).pass,
});

export const createV66VisualAcceptanceMatrix = () => [
  { id: 'forest-clear', biome: 'forest', weather: 'clear', expected: ['readable-canopy', 'grounding', 'luma'] },
  { id: 'wetland-storm', biome: 'wetland', weather: 'storm', expected: ['water-edge', 'fog', 'runoff'] },
  { id: 'alpine-snow', biome: 'alpine', weather: 'snow', expected: ['snowline', 'rock', 'exposure'] },
  { id: 'taiga-winter', biome: 'taiga', weather: 'winter', expected: ['phenology', 'wildlife', 'low-luma-guard'] },
  { id: 'steppe-dry', biome: 'steppe', weather: 'dry', expected: ['grass', 'drydown', 'dust'] },
  { id: 'coastal-wind', biome: 'coastal', weather: 'wind', expected: ['shore', 'wave', 'vegetation-motion'] },
];

export const getV66AuditSummary = () => Object.freeze({ contract: V66_AUDIT_POLICY, acceptanceCamera: { width: 1536, height: 1024, projection: 'orthographic', fovDegrees: 90 }, features: ['p0', 'p1', 'visual-matrix'] });
