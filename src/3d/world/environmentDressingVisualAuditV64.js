const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp01 = (value) => Math.min(1, Math.max(0, finite(value)));
const round = (value, digits = 5) => {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
};

function hash(value) {
  let h = 2166136261;
  for (const char of String(value)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

export const V64_VISUAL_AUDIT_POLICY = Object.freeze({
  id: 'buzul-muhafizi-environment-dressing-visual-audit-v64-20260914',
  target: Object.freeze({
    seams: 0,
    rectangularWater: 0,
    moire: 0,
    cyan: 0,
    floating: 0,
    interpenetrating: 0,
    placeholders: 0,
    blackSky: 0,
  }),
  camera: Object.freeze({ width: 1536, height: 1024, orthographicDegrees: 90 }),
});

function riskFlag(value) {
  return clamp01(value) > 0.2 ? 1 : 0;
}

export function auditV64Sample(sample = {}) {
  const water = sample.water ?? {};
  const terrain = sample.terrain ?? {};
  const vegetation = Array.isArray(sample.vegetation) ? sample.vegetation : [];
  const camera = sample.camera ?? {};
  const risks = {
    seam: riskFlag(water.seamRisk),
    rectangularWater: water.rectangular === true ? 1 : 0,
    moire: riskFlag(water.moireRisk) || water.repeatedStripe === true ? 1 : 0,
    cyan: riskFlag(water.cyanRisk),
    floating: vegetation.filter((item) => item.grounded === false).length,
    interpenetrating: vegetation.filter((item) => item.interpenetrating === true).length,
    placeholders: sample.material?.placeholder === true ? 1 : 0,
    blackSky: finite(sample.backgroundLuminance, 0.16) < 0.04 ? 1 : 0,
  };
  const parity = Math.max(
    Math.abs(finite(sample.renderedY) - finite(terrain.canonicalHeight, sample.renderedY)),
    Math.abs(finite(sample.colliderY) - finite(terrain.canonicalHeight, sample.colliderY)),
  );
  const cameraValid = camera.width === 1536 && camera.height === 1024 && camera.orthographicDegrees === 90;
  const errors = [];
  for (const [key, target] of Object.entries(V64_VISUAL_AUDIT_POLICY.target)) {
    if ((risks[key] ?? 0) > target) errors.push(key);
  }
  if (parity > 0.35) errors.push('parity');
  if (!cameraValid) errors.push('camera');
  const vegetationGrounding = vegetation.every((item) => item.grounded !== false && finite(item.groundConfidence, 1) >= 0.72);
  if (!vegetationGrounding) errors.push('vegetation-grounding');
  return freeze({
    contract: V64_VISUAL_AUDIT_POLICY.id,
    risks: freeze(risks),
    parityMeters: round(parity),
    cameraValid,
    vegetationGrounding,
    pass: errors.length === 0,
    errors: Object.freeze(errors),
    fingerprint: hash(JSON.stringify({ risks, parity, cameraValid, vegetationGrounding })),
  });
}

export function compareV64SampleAudits(before, after) {
  const a = auditV64Sample(before);
  const b = auditV64Sample(after);
  const beforeRisk = Object.values(a.risks).reduce((sum, value) => sum + value, 0);
  const afterRisk = Object.values(b.risks).reduce((sum, value) => sum + value, 0);
  return freeze({
    improved: afterRisk <= beforeRisk && b.parityMeters <= a.parityMeters,
    riskDelta: beforeRisk - afterRisk,
    parityDelta: round(a.parityMeters - b.parityMeters),
    before: a,
    after: b,
    fingerprint: hash(`${a.fingerprint}|${b.fingerprint}`),
  });
}

export function createV64DeterministicCameraSet(seed = 'v64-camera-audit') {
  const profiles = [
    ['full-world', 7000],
    ['far', 3600],
    ['terrain-near-center', 420],
    ['terrain-near-northwest', 360],
  ];
  return freeze(profiles.map(([profile, distance], index) => freeze({
    profile,
    distance,
    width: V64_VISUAL_AUDIT_POLICY.camera.width,
    height: V64_VISUAL_AUDIT_POLICY.camera.height,
    orthographicDegrees: V64_VISUAL_AUDIT_POLICY.camera.orthographicDegrees,
    seed: `${seed}-${index}`,
  })));
}
