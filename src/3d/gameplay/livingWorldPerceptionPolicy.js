const DEFAULTS = Object.freeze({
  viewDistanceMeters: 36,
  viewHalfAngleDegrees: 55,
  hearingDistanceMeters: 18,
  stealthMultiplier: 0.45,
  minConfidence: 0.2,
});

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeVector(vector) {
  const x = finite(vector?.x);
  const z = finite(vector?.z);
  const length = Math.hypot(x, z);
  return length > 0 ? { x: x / length, z: z / length } : null;
}

function distance(a, b) {
  return Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z));
}

export function evaluatePerception(observer, target, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const observerPosition = observer?.position;
  const targetPosition = target?.position;
  const distanceMeters = distance(observerPosition, targetPosition);
  const observerForward = normalizeVector(observer?.forward) ?? { x: 0, z: 1 };
  const toTarget = normalizeVector({
    x: finite(targetPosition?.x) - finite(observerPosition?.x),
    z: finite(targetPosition?.z) - finite(observerPosition?.z),
  });
  const dot = toTarget ? clamp(observerForward.x * toTarget.x + observerForward.z * toTarget.z, -1, 1) : 1;
  const angleDegrees = toTarget ? Math.acos(dot) * (180 / Math.PI) : 0;
  const stealth = clamp(finite(target?.stealth, 0), 0, 1);
  const noise = clamp(finite(target?.noise, 0), 0, 1);
  const lineOfSight = target?.lineOfSight !== false;
  const inViewCone = distanceMeters <= config.viewDistanceMeters && angleDegrees <= config.viewHalfAngleDegrees;
  const audible = distanceMeters <= config.hearingDistanceMeters && noise > 0;
  const visualConfidence = inViewCone && lineOfSight
    ? clamp((1 - distanceMeters / Math.max(config.viewDistanceMeters, 1)) * (1 - stealth * config.stealthMultiplier), 0, 1)
    : 0;
  const hearingConfidence = audible ? clamp((1 - distanceMeters / Math.max(config.hearingDistanceMeters, 1)) * noise, 0, 1) : 0;
  const confidence = Math.max(visualConfidence, hearingConfidence);
  const channel = visualConfidence >= hearingConfidence && visualConfidence > 0 ? 'visual' : hearingConfidence > 0 ? 'hearing' : 'none';
  return Object.freeze({
    detected: confidence >= config.minConfidence,
    channel,
    confidence: Number(confidence.toFixed(6)),
    distanceMeters: Number(distanceMeters.toFixed(6)),
    angleDegrees: Number(angleDegrees.toFixed(6)),
    lineOfSight,
    inViewCone,
    audible,
  });
}

export function summarizePerception(observer, targets, options = {}) {
  const rows = [];
  for (const target of targets ?? []) {
    const result = evaluatePerception(observer, target, options);
    if (!result.detected) continue;
    rows.push({
      id: String(target?.id ?? ''),
      ...result,
    });
  }
  rows.sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id));
  const maxDetections = Math.max(0, Math.floor(finite(options.maxDetections, rows.length)));
  return Object.freeze({
    detections: Object.freeze(rows.slice(0, maxDetections)),
    truncated: rows.length > maxDetections,
  });
}
