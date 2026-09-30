const clamp = (v, min, max) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
const round = (v, p = 3) => Number((Number.isFinite(v) ? v : 0).toFixed(p));

export const V65_STREAMING_POLICY = Object.freeze({
  id: 'environment-runtime-streaming-v65-2026-09-14',
  desktop: Object.freeze({ fpsFloor: 50, drawCalls: 180, triangles: 1800000, texturesMb: 950, residentChunks: 9 }),
  mobile: Object.freeze({ fpsFloor: 35, drawCalls: 90, triangles: 650000, texturesMb: 600, residentChunks: 5 }),
  tiers: Object.freeze(['near', 'mid', 'far', 'impostor']),
  deterministic: true,
});

export const normalizeMetrics = (metrics = {}) => ({
  fps: Math.max(0, Number.isFinite(metrics.fps) ? metrics.fps : 60),
  drawCalls: Math.max(0, Math.round(metrics.drawCalls ?? 0)),
  triangles: Math.max(0, Math.round(metrics.triangles ?? 0)),
  texturesMb: Math.max(0, Number(metrics.texturesMb ?? 0)),
  residentChunks: Math.max(0, Math.round(metrics.residentChunks ?? 0)),
  visibleInstances: Math.max(0, Math.round(metrics.visibleInstances ?? 0)),
  cameraVelocity: Math.max(0, Number(metrics.cameraVelocity ?? 0)),
});

export const budgetFor = (platform = 'desktop') => platform === 'mobile' ? V65_STREAMING_POLICY.mobile : V65_STREAMING_POLICY.desktop;

export const budgetUsage = (metrics, platform = 'desktop') => {
  const m = normalizeMetrics(metrics);
  const b = budgetFor(platform);
  return {
    fps: round(b.fpsFloor / Math.max(m.fps, 1)),
    drawCalls: round(m.drawCalls / b.drawCalls),
    triangles: round(m.triangles / b.triangles),
    textures: round(m.texturesMb / b.texturesMb),
    residentChunks: round(m.residentChunks / b.residentChunks),
    max: round(Math.max(b.fpsFloor / Math.max(m.fps, 1), m.drawCalls / b.drawCalls, m.triangles / b.triangles, m.texturesMb / b.texturesMb, m.residentChunks / b.residentChunks)),
  };
};

export const classifyPressure = (usage) => usage.max <= 0.82 ? 'low' : usage.max <= 1 ? 'target' : usage.max <= 1.18 ? 'high' : 'critical';

export const cullScore = (item = {}, camera = {}) => {
  const distance = Math.max(0, Number(item.distance ?? 9999));
  const projected = clamp(Number(item.projectedSize ?? 0), 0, 1);
  const importance = clamp(Number(item.importance ?? 0.5), 0, 1);
  const gameplay = item.gameplayCritical ? 1 : 0;
  const speed = clamp(Number(camera.velocity ?? 0) / 120, 0, 1);
  return round(importance * 0.34 + projected * 0.32 + gameplay * 0.42 - distance / 9000 - speed * 0.08);
};

export const selectTier = (item = {}, camera = {}) => {
  const distance = Math.max(0, Number(item.distance ?? 9999));
  const score = cullScore(item, camera);
  if (item.gameplayCritical && distance < 260) return 'near';
  if (distance < 650 && score > 0.22) return 'near';
  if (distance < 1800 && score > -0.1) return 'mid';
  if (distance < 4200 && score > -0.4) return 'far';
  return 'impostor';
};

export const tierBudgets = (platform = 'desktop') => {
  const b = budgetFor(platform);
  const factor = platform === 'mobile' ? 0.72 : 1;
  return {
    near: Math.round(b.triangles * 0.42 * factor),
    mid: Math.round(b.triangles * 0.3 * factor),
    far: Math.round(b.triangles * 0.18 * factor),
    impostor: Math.round(b.triangles * 0.06 * factor),
  };
};

export const buildCullingPlan = ({ items = [], camera = {}, platform = 'desktop' } = {}) => {
  const tiers = { near: [], mid: [], far: [], impostor: [] };
  for (const item of items) {
    const tier = selectTier(item, camera);
    tiers[tier].push({ id: item.id || `${item.family}:${item.distance}`, tier, score: cullScore(item, camera) });
  }
  for (const tier of Object.keys(tiers)) tiers[tier].sort((a, b) => b.score - a.score);
  const budgets = tierBudgets(platform);
  return {
    platform,
    tiers,
    budgets,
    counts: Object.fromEntries(Object.entries(tiers).map(([key, values]) => [key, values.length])),
    pressure: classifyPressure(budgetUsage({ triangles: items.length * 1800 }, platform)),
  };
};

export const streamingRadius = (platform, velocity = 0) => {
  const base = platform === 'mobile' ? 1100 : 1700;
  const speedPenalty = clamp(velocity / 140, 0, 1) * 280;
  return round(base - speedPenalty);
};

export const residentChunkPlan = ({ center, chunks = [], platform = 'desktop', velocity = 0 } = {}) => {
  const limit = budgetFor(platform).residentChunks;
  const radius = streamingRadius(platform, velocity);
  const cx = Number(center?.x ?? 0);
  const cz = Number(center?.z ?? 0);
  return chunks
    .map((chunk) => ({
      key: chunk.key,
      distance: Math.hypot((chunk.x ?? 0) - cx, (chunk.z ?? 0) - cz),
      continuity: chunk.continuity ?? 1,
      importance: chunk.importance ?? 0.5,
    }))
    .filter((item) => item.distance <= radius)
    .sort((a, b) => (b.importance + b.continuity) - (a.importance + a.continuity) || a.distance - b.distance)
    .slice(0, limit);
};

export const adaptiveBudget = ({ metrics = {}, platform = 'desktop', targetFps = null } = {}) => {
  const b = budgetFor(platform);
  const m = normalizeMetrics(metrics);
  const usage = budgetUsage(m, platform);
  const fpsTarget = targetFps ?? b.fpsFloor;
  const pressure = classifyPressure(usage);
  const factor = pressure === 'critical' ? 0.7 : pressure === 'high' ? 0.85 : pressure === 'low' ? 1.08 : 1;
  return {
    pressure,
    factor: round(factor),
    targetFps: fpsTarget,
    drawCalls: Math.max(20, Math.floor(b.drawCalls * factor)),
    triangles: Math.max(100000, Math.floor(b.triangles * factor)),
    texturesMb: Math.max(180, Math.floor(b.texturesMb * factor)),
    residentChunks: Math.max(2, Math.floor(b.residentChunks * factor)),
  };
};

export const lodHysteresis = ({ previous = 'mid', next = 'far', distance = 1000, cameraVelocity = 0 } = {}) => {
  const order = ['near', 'mid', 'far', 'impostor'];
  const from = order.indexOf(previous);
  const to = order.indexOf(next);
  if (from < 0 || to < 0) return next;
  const margin = 110 + clamp(cameraVelocity / 3, 0, 160);
  const thresholds = { near: 650, mid: 1800, far: 4200 };
  if (to > from && thresholds[previous] && distance < thresholds[previous] + margin) return previous;
  if (to < from && thresholds[next] && distance > thresholds[next] - margin) return previous;
  return next;
};

export const buildFrameEnvelope = ({ items = [], metrics = {}, camera = {}, platform = 'desktop' } = {}) => {
  const plan = buildCullingPlan({ items, camera, platform });
  const budget = adaptiveBudget({ metrics, platform });
  const usage = budgetUsage(metrics, platform);
  return {
    policy: V65_STREAMING_POLICY.id,
    platform,
    plan,
    budget,
    usage,
    pressure: classifyPressure(usage),
    overBudget: usage.max > 1,
  };
};

export const validateStreamingEnvelope = (envelope) => {
  const errors = [];
  if (envelope?.policy !== V65_STREAMING_POLICY.id) errors.push('policy');
  if (!['desktop', 'mobile'].includes(envelope?.platform)) errors.push('platform');
  if (!envelope?.plan?.tiers) errors.push('tiers');
  if (envelope?.budget?.factor <= 0) errors.push('budget-factor');
  return { ok: errors.length === 0, errors };
};

export const streamingTelemetry = (envelope) => ({
  policy: V65_STREAMING_POLICY.id,
  platform: envelope?.platform,
  pressure: envelope?.pressure,
  overBudget: envelope?.overBudget === true,
  usage: envelope?.usage,
  tierCounts: envelope?.plan?.counts || {},
});
