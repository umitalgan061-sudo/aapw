const DEFAULTS = Object.freeze({
  viewDistanceMeters: 36,
  viewHalfAngleDegrees: 55,
  hearingDistanceMeters: 18,
  stealthMultiplier: 0.45,
  minConfidence: 0.2,
});

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.z);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeVector(vector) {
  if (!Number.isFinite(vector?.x) || !Number.isFinite(vector?.z)) return null;
  const length = Math.hypot(vector.x, vector.z);
  return length > 0 ? { x: vector.x / length, z: vector.z / length } : null;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function normalizedConfig(options) {
  const config = { ...DEFAULTS, ...options };
  if (!Number.isFinite(config.viewDistanceMeters) || config.viewDistanceMeters <= 0) return null;
  if (!Number.isFinite(config.viewHalfAngleDegrees) || config.viewHalfAngleDegrees < 0 || config.viewHalfAngleDegrees > 180) return null;
  if (!Number.isFinite(config.hearingDistanceMeters) || config.hearingDistanceMeters <= 0) return null;
  if (!Number.isFinite(config.stealthMultiplier) || config.stealthMultiplier < 0) return null;
  if (!Number.isFinite(config.minConfidence) || config.minConfidence < 0 || config.minConfidence > 1) return null;
  return config;
}

export function evaluatePerception(observer, target, options = {}) {
  const config = normalizedConfig(options);
  const observerPosition = observer?.position;
  const targetPosition = target?.position;
  const forward = normalizeVector(observer?.forward);
  if (!config || !isFinitePoint(observerPosition) || !isFinitePoint(targetPosition) || !forward) {
    return Object.freeze({ detected: false, channel: 'none', confidence: 0, distanceMeters: null, angleDegrees: null, lineOfSight: false, inViewCone: false, audible: false, invalidInput: true });
  }

  const distanceMeters = distance(observerPosition, targetPosition);
  const toTarget = normalizeVector({ x: targetPosition.x - observerPosition.x, z: targetPosition.z - observerPosition.z });
  const dot = toTarget ? clamp(forward.x * toTarget.x + forward.z * toTarget.z, -1, 1) : 1;
  const angleDegrees = toTarget ? Math.acos(dot) * (180 / Math.PI) : 0;
  const stealth = clamp(Number.isFinite(target?.stealth) ? target.stealth : 0, 0, 1);
  const noise = clamp(Number.isFinite(target?.noise) ? target.noise : 0, 0, 1);
  const lineOfSight = target?.lineOfSight !== false;
  const inViewCone = distanceMeters <= config.viewDistanceMeters && angleDegrees <= config.viewHalfAngleDegrees;
  const audible = distanceMeters <= config.hearingDistanceMeters && noise > 0;
  const visualConfidence = inViewCone && lineOfSight
    ? clamp((1 - distanceMeters / config.viewDistanceMeters) * (1 - stealth * config.stealthMultiplier), 0, 1)
    : 0;
  const hearingConfidence = audible ? clamp((1 - distanceMeters / config.hearingDistanceMeters) * noise, 0, 1) : 0;
  const confidence = Math.max(visualConfidence, hearingConfidence);
  const channel = visualConfidence >= hearingConfidence && visualConfidence > 0 ? 'visual' : hearingConfidence > 0 ? 'hearing' : 'none';
  return Object.freeze({ detected: confidence >= config.minConfidence, channel, confidence: Number(confidence.toFixed(6)), distanceMeters: Number(distanceMeters.toFixed(6)), angleDegrees: Number(angleDegrees.toFixed(6)), lineOfSight, inViewCone, audible, invalidInput: false });
}

export function summarizePerception(observer, targets, options = {}) {
  const rows = [];
  for (const target of targets ?? []) {
    const result = evaluatePerception(observer, target, options);
    if (!result.detected) continue;
    rows.push({ id: String(target?.id ?? ''), ...result });
  }
  rows.sort((left, right) => right.confidence - left.confidence || left.distanceMeters - right.distanceMeters || left.id.localeCompare(right.id));
  const maxDetections = Number.isFinite(options.maxDetections) ? Math.max(0, Math.floor(options.maxDetections)) : rows.length;
  return Object.freeze({ detections: Object.freeze(rows.slice(0, maxDetections)), truncated: rows.length > maxDetections, invalidTargets: (targets ?? []).length - rows.length });
}
