/**
 * Defensive quality guards for groundwater presentation.
 *
 * Guards do not alter source terrain data. They sanitize and classify render
 * payloads so upstream layers cannot accidentally bypass the groundwater
 * material budget or canonical-geometry contract.
 */
import { TERRAIN_GROUNDWATER_POLICY, resolveTerrainGroundwaterState } from './terrainGroundwaterRegime.js';
import { TERRAIN_GROUNDWATER_ADAPTER_POLICY, resolveGroundwaterSurfaceFrame } from './terrainGroundwaterSurfaceAdapter.js';

const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
const freeze = Object.freeze;
const safe = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const TERRAIN_GROUNDWATER_GUARD_POLICY = freeze({
  id: 'terrain-groundwater-quality-guards-2026-09-15-v1',
  sourcePolicyId: TERRAIN_GROUNDWATER_POLICY.id,
  adapterPolicyId: TERRAIN_GROUNDWATER_ADAPTER_POLICY.id,
  renderOnly: true,
  deterministic: true,
  rejectsGeometryMutation: true,
  rejectsHydrologyMutation: true,
  rejectsOutOfRangeChannels: true,
});

export const GUARDED_CHANNELS = freeze(['wetness','surfaceFilm','waterTableProximity','capillaryRise','seepageFace','saturation','memory','dryingResistance','puddlePersistence','marshEdge','fineTransport','saltRing','freezeWetness','dryingDemand']);

export function sanitizeChannelSet(channels = {}) {
  const output = {};
  const changes = {};
  for (const key of GUARDED_CHANNELS) {
    const raw = channels[key];
    const numeric = Number(raw);
    const sanitized = clamp01(numeric);
    output[key] = sanitized;
    if (!Number.isFinite(numeric) || Math.abs(sanitized - numeric) > 1e-12) changes[key] = sanitized;
  }
  return freeze({ channels: freeze(output), changes: freeze(changes), changed: Object.keys(changes).length > 0 });
}

export function sanitizeMaterial(material = {}) {
  const color = material.color ?? {};
  const output = {
    color: freeze({ r: clamp01(safe(color.r, .5)), g: clamp01(safe(color.g, .42)), b: clamp01(safe(color.b, .32)) }),
    roughness: clamp(safe(material.roughness, .86), .42, 1),
    normalStrength: clamp(safe(material.normalStrength, 0), 0, TERRAIN_GROUNDWATER_POLICY.maxNormalStrength),
    wetness: clamp01(safe(material.wetness, 0)),
  };
  return freeze(output);
}

export function guardFrame(frame) {
  const channelResult = sanitizeChannelSet(frame?.channels);
  const material = sanitizeMaterial(frame?.material);
  const canonical = frame?.canonical ?? {};
  const failures = [];
  if (canonical.heightUnchanged !== true) failures.push('height');
  if (canonical.hydrologyUnchanged !== true) failures.push('hydrology');
  if (canonical.coastlineUnchanged !== true) failures.push('coastline');
  if (canonical.colliderUnchanged !== true) failures.push('collider');
  if (canonical.vegetationPlacementUnchanged !== true) failures.push('vegetation');
  if (canonical.newGeographyIntroduced !== false) failures.push('new-geography');
  return freeze({ ok: failures.length === 0, failures: freeze(failures), channelSanitized: channelResult.changed, channelChanges: channelResult.changes, channels: channelResult.channels, material, canonical });
}

export function guardedResolve(input = {}, options = {}) {
  const frame = resolveGroundwaterSurfaceFrame(input);
  const guard = guardFrame(frame);
  if (guard.failures.length) throw new TypeError(`groundwater canonical invariant failure: ${guard.failures.join(',')}`);
  if (options.rejectSanitization && guard.channelSanitized) throw new RangeError('groundwater channel payload required sanitization');
  return freeze({ ...frame, channels: guard.channels, material: guard.material, guard });
}

export function canonicalPayloadSignature(frame) {
  const guard = guardFrame(frame);
  return freeze({
    policyId: TERRAIN_GROUNDWATER_GUARD_POLICY.id,
    ok: guard.ok,
    geometry: `${guard.canonical.heightUnchanged}-${guard.canonical.hydrologyUnchanged}-${guard.canonical.coastlineUnchanged}-${guard.canonical.colliderUnchanged}`,
    vegetation: guard.canonical.vegetationPlacementUnchanged,
    newGeography: guard.canonical.newGeographyIntroduced,
    channelCount: GUARDED_CHANNELS.length,
  });
}

export function validateMaterialDelta(before, after, budget = TERRAIN_GROUNDWATER_POLICY) {
  const base = sanitizeMaterial(before);
  const next = sanitizeMaterial(after);
  const deltas = freeze({
    red: next.color.r - base.color.r,
    green: next.color.g - base.color.g,
    blue: next.color.b - base.color.b,
    roughness: next.roughness - base.roughness,
    normalStrength: next.normalStrength - base.normalStrength,
    wetness: next.wetness - base.wetness,
  });
  const colorMagnitude = Math.max(Math.abs(deltas.red), Math.abs(deltas.green), Math.abs(deltas.blue));
  const ok = colorMagnitude <= (budget.maxAlbedoShift ?? .12) + 1e-9 && Math.abs(deltas.roughness) <= (budget.maxRoughnessShift ?? .12) + 1e-9 && next.normalStrength <= (budget.maxNormalStrength ?? .08) + 1e-9;
  return freeze({ ok, deltas, colorMagnitude, roughnessWithinBudget: Math.abs(deltas.roughness) <= (budget.maxRoughnessShift ?? .12) + 1e-9, normalWithinBudget: next.normalStrength <= (budget.maxNormalStrength ?? .08) + 1e-9 });
}

export function stateInputGuard(input = {}) {
  const state = resolveTerrainGroundwaterState(input);
  const sample = state.sample;
  const fields = ['worldX','worldZ','heightMeters','slopeDegrees','moisture','rainfall','runoff','soilDepth','permeability','waterDistanceMeters','groundwaterDepthMeters','wetDays','dryDays','dayOfYear','temperatureC','drainage','windExposure'];
  const invalid = fields.filter((key) => !Number.isFinite(Number(sample[key])));
  return freeze({ ok: invalid.length === 0, invalid: freeze(invalid), sample });
}

export function assertRenderOnlyUserData(userData = {}) {
  const forbidden = ['terrainGroundwaterHeightMutation','terrainGroundwaterHydrologyMutation','terrainGroundwaterColliderMutation','terrainGroundwaterVegetationPlacementMutation'];
  const present = forbidden.filter((key) => userData[key] === true);
  return freeze({ ok: present.length === 0, forbiddenWrites: freeze(present) });
}

export function guardMaterialInstall(material) {
  if (!material || typeof material !== 'object') throw new TypeError('groundwater material must be an object');
  const userDataResult = assertRenderOnlyUserData(material.userData ?? {});
  if (!userDataResult.ok) throw new TypeError(`groundwater material contains forbidden writes: ${userDataResult.forbiddenWrites.join(',')}`);
  return material;
}

export function clampBlendMix(mix) { return clamp01(safe(mix, .5)); }
export function clampEventIntensity(intensity) { return clamp01(safe(intensity, .5)); }
export function clampEdgeStrength(strength) { return clamp01(safe(strength, .35)); }

export function compareGuardedOutputs(a, b) {
  const first = guardFrame(a);
  const second = guardFrame(b);
  const channelDelta = {};
  for (const key of GUARDED_CHANNELS) channelDelta[key] = second.channels[key] - first.channels[key];
  return freeze({ channelDelta: freeze(channelDelta), firstOk: first.ok, secondOk: second.ok, equalCanonical: JSON.stringify(first.canonical) === JSON.stringify(second.canonical) });
}

export function guardGrid(inputs = []) {
  if (!Array.isArray(inputs)) return freeze([]);
  return freeze(inputs.map((input) => {
    const frame = guardedResolve(input);
    return freeze({ x: frame.state.sample.worldX, z: frame.state.sample.worldZ, signature: canonicalPayloadSignature(frame), channelSanitized: frame.guard.channelSanitized, classification: frame.channels.wetness > .7 ? 'wet' : frame.channels.dryingDemand > .7 ? 'dry' : 'neutral' });
  }));
}

export function guardReport(input = {}) {
  const inputReport = stateInputGuard(input);
  const frame = guardedResolve(input);
  const canonical = canonicalPayloadSignature(frame);
  return freeze({ policyId: TERRAIN_GROUNDWATER_GUARD_POLICY.id, input: inputReport, canonical, guard: frame.guard });
}

export function enforceBudgetOrFallback(frame, fallbackMaterial = { color: { r: .5, g: .42, b: .32 }, roughness: .86, normalStrength: 0, wetness: 0 }) {
  const safeFrame = guardFrame(frame);
  const fallback = sanitizeMaterial(fallbackMaterial);
  const budget = validateMaterialDelta(fallback, safeFrame.material);
  if (budget.ok) return freeze({ material: safeFrame.material, fallbackUsed: false, budget });
  return freeze({ material: fallback, fallbackUsed: true, budget });
}

export function guardedStateSignature(input = {}) {
  const state = resolveTerrainGroundwaterState(input);
  const frame = resolveGroundwaterSurfaceFrame(input);
  const guard = guardFrame(frame);
  return freeze({ policyId: TERRAIN_GROUNDWATER_GUARD_POLICY.id, statePolicyId: state.policyId, adapterPolicyId: frame.policyId, wetness: Number(guard.channels.wetness.toFixed(6)), saturation: Number(guard.channels.saturation.toFixed(6)), seepage: Number(guard.channels.seepageFace.toFixed(6)), canonicalOk: guard.ok });
}
