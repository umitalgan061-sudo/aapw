/**
 * Groundwater-driven surface detail layer.
 *
 * This module is intentionally render-only. It consumes environmental context
 * and produces bounded presentation signals for wet rims, capillary dampening,
 * drying fronts, mineral crust and micro-puddle edges. It does not create or
 * mutate geometry, hydrology topology, collision data or vegetation placement.
 */
import { resolveTerrainGroundwaterState, TERRAIN_GROUNDWATER_POLICY } from './terrainGroundwaterRegime.js';

const freeze = Object.freeze;
const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
const safe = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (edge0, edge1, value) => {
  const t = clamp01((safe(value) - edge0) / Math.max(1e-9, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export const TERRAIN_GROUNDWATER_DETAIL_POLICY = freeze({
  id: 'terrain-groundwater-surface-detail-2026-09-15-v1',
  sourcePolicyId: TERRAIN_GROUNDWATER_POLICY.id,
  renderOnly: true,
  deterministic: true,
  canonicalHeightUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalCoastlineUnchanged: true,
  canonicalColliderUnchanged: true,
  canonicalVegetationPlacementUnchanged: true,
  newGeographyIntroduced: false,
  maxWetRim: 0.9,
  maxDryFront: 0.78,
  maxCrust: 0.72,
  maxMicroRelief: 0.34,
  maxNormalStrength: 0.055,
  materialKey: 'terrain-groundwater-surface-detail-v1',
});

export const TERRAIN_GROUNDWATER_DETAIL_CHANNELS = freeze([
  'wetRim',
  'capillaryDamp',
  'seepageDarkening',
  'puddleCore',
  'puddleEdge',
  'evaporationFront',
  'mineralCrust',
  'fineSedimentFilm',
  'recoveryHalo',
  'freezeWetEdge',
  'marshTransition',
  'dryingContrast',
  'microRelief',
  'surfaceConfidence',
]);

function normalizedGroundwater(input = {}) {
  return resolveTerrainGroundwaterState(input);
}

function groundwaterField(state) {
  const field = state?.field ?? {};
  return freeze({
    regional: clamp01(field.regional),
    local: clamp01(field.local),
    capillary: clamp01(field.capillary),
    seepage: clamp01(field.seepage),
    contour: clamp01(field.contour),
    combined: clamp01(field.combined),
  });
}

export function wetRimSignal(stateInput = {}) {
  const state = stateInput.policyId === TERRAIN_GROUNDWATER_POLICY.id ? stateInput : normalizedGroundwater(stateInput);
  const wetness = clamp01(state.surfaceFilm);
  const puddle = clamp01(state.puddlePersistence);
  const proximity = clamp01(state.waterTableProximity);
  const field = groundwaterField(state);
  const rim = smooth(.34, .75, wetness) * (1 - smooth(.76, .96, wetness));
  return clamp01(rim * .48 + puddle * .22 + proximity * .18 + field.local * .12);
}

export function capillaryDampSignal(stateInput = {}) {
  const state = stateInput.policyId === TERRAIN_GROUNDWATER_POLICY.id ? stateInput : normalizedGroundwater(stateInput);
  const capillary = clamp01(state.capillaryRise);
  const resistance = clamp01(state.dryingResistance);
  const moisture = clamp01(state.sample?.moisture);
  const shallow = 1 - smooth(2.5, 9.5, safe(state.sample?.slopeDegrees));
  return clamp01(capillary * .52 + resistance * .25 + moisture * .13 + shallow * .10);
}

export function seepageDarkeningSignal(stateInput = {}) {
  const state = stateInput.policyId === TERRAIN_GROUNDWATER_POLICY.id ? stateInput : normalizedGroundwater(stateInput);
  const seepage = clamp01(state.seepageFace);
  const saturation = clamp01(state.surfaceSaturation);
  const slope = safe(state.sample?.slopeDegrees);
  const band = smooth(4, 24, slope) * (1 - smooth(24, 48, slope));
  return clamp01(seepage * .58 + saturation * .22 + band * .20);
}

export function puddleCoreSignal(stateInput = {}) {
  const state = stateInput.policyId === TERRAIN_GROUNDWATER_POLICY.id ? stateInput : normalizedGroundwater(stateInput);
  const persistence = clamp01(state.puddlePersistence);
  const film = clamp01(state.surfaceFilm);
  const flatness = 1 - smooth(1.5, 9, safe(state.sample?.slopeDegrees));
  return clamp01(persistence * .58 + film * .22 + flatness * .20);
}

export function puddleEdgeSignal(stateInput = {}, localContrast = .5) {
  const state = stateInput.policyId === TERRAIN_GROUNDWATER_POLICY.id ? stateInput : normalizedGroundwater(stateInput);
  const core = puddleCoreSignal(state);
  const rim = wetRimSignal(state);
  const contrast = clamp01(localContrast);
  return clamp01((1 - core) * rim * .52 + contrast * rim * .48);
}

export function evaporationFrontSignal(stateInput = {}) {
  const state = stateInput.policyId === TERRAIN_GROUNDWATER_POLICY.id ? stateInput : normalizedGroundwater(stateInput);
  const mineral = state.mineralMobilization ?? {};
  const salt = clamp01(mineral.saltRing);
  const demand = clamp01(1 - state.dryingResistance);
  const film = clamp01(state.surfaceFilm);
  const temperature = smooth(8, 34, safe(state.sample?.temperatureC, 12));
  const front = temperature * demand * (1 - film);
  return clamp01(front * .54 + salt * .31 + demand * .15);
}

export function mineralCrustSignal(stateInput = {}) {
  const state = stateInput.policyId === TERRAIN_GROUNDWATER_POLICY.id ? stateInput : normalizedGroundwater(stateInput);
  const mineral = state.mineralMobilization ?? {};
  const salt = clamp01(mineral.saltRing);
  const seepage = clamp01(state.seepageFace);
  const drying = clamp01(1 - state.dryingResistance);
  const flat = 1 - smooth(4, 32, safe(state.sample?.slopeDegrees));
  return clamp01(salt * .55 + seepage * .14 + drying * .21 + flat * .10);
}

export function fineSedimentFilmSignal(stateInput = {}) {
  const state = stateInput.policyId === TERRAIN_GROUNDWATER_POLICY.id ? stateInput : normalizedGroundwater(stateInput);
  const mineral = state.mineralMobilization ?? {};
  const fine = clamp01(mineral.fineTransport);
  const film = clamp01(state.surfaceFilm);
  const runoff = clamp01(state.sample?.runoff);
  return clamp01(fine * .55 + film * .27 + runoff * .18);
}

export function recoveryHaloSignal(stateInput = {}) {
  const state = stateInput.policyId === TERRAIN_GROUNDWATER_POLICY.id ? stateInput : normalizedGroundwater(stateInput);
  const memory = clamp01(state.saturationMemory);
  const drying = clamp01(state.dryingResistance);
  const film = clamp01(state.surfaceFilm);
  return clamp01(memory * .46 + drying * .34 + film * .20);
}

export function freezeWetEdgeSignal(stateInput = {}) {
  const state = stateInput.policyId === TERRAIN_GROUNDWATER_POLICY.id ? stateInput : normalizedGroundwater(stateInput);
  const stress = clamp01(state.stress?.freezeStress);
  const wet = clamp01(state.surfaceSaturation);
  const temperature = 1 - smooth(0, 6, safe(state.sample?.temperatureC, 12));
  return clamp01(stress * .54 + wet * .31 + temperature * .15);
}

export function marshTransitionSignal(stateInput = {}) {
  const state = stateInput.policyId === TERRAIN_GROUNDWATER_POLICY.id ? stateInput : normalizedGroundwater(stateInput);
  const marsh = clamp01(state.marshEdgeFactor);
  const wet = clamp01(state.surfaceSaturation);
  const lowland = 1 - smooth(20, 120, safe(state.sample?.heightMeters));
  return clamp01(marsh * .48 + wet * .34 + lowland * .18);
}

export function dryingContrastSignal(stateInput = {}) {
  const state = stateInput.policyId === TERRAIN_GROUNDWATER_POLICY.id ? stateInput : normalizedGroundwater(stateInput);
  const demand = clamp01(1 - state.dryingResistance);
  const evaporation = evaporationFrontSignal(state);
  const memory = clamp01(state.saturationMemory);
  return clamp01(demand * .48 + evaporation * .37 + (1 - memory) * .15);
}

export function microReliefSignal(stateInput = {}) {
  const state = stateInput.policyId === TERRAIN_GROUNDWATER_POLICY.id ? stateInput : normalizedGroundwater(stateInput);
  const field = groundwaterField(state);
  const slope = clamp01(safe(state.sample?.slopeDegrees) / 89);
  const fine = fineSedimentFilmSignal(state);
  return clamp01(field.capillary * .30 + field.seepage * .24 + fine * .24 + slope * .08 + field.local * .14);
}

export function surfaceConfidenceSignal(stateInput = {}) {
  const state = stateInput.policyId === TERRAIN_GROUNDWATER_POLICY.id ? stateInput : normalizedGroundwater(stateInput);
  const sample = state.sample ?? {};
  const completeness = ['worldX','worldZ','heightMeters','slopeDegrees','moisture','rainfall','runoff','soilDepth','permeability','waterDistanceMeters','groundwaterDepthMeters','wetDays','dryDays','dayOfYear','temperatureC','drainage','windExposure'].reduce((score, key) => score + Number.isFinite(Number(sample[key])) ? 1 : 0, 0) / 17;
  const field = groundwaterField(state);
  return clamp01(completeness * .64 + field.combined * .36);
}

export function resolveGroundwaterSurfaceDetail(input = {}) {
  const state = normalizedGroundwater(input);
  const channels = freeze({
    wetRim: wetRimSignal(state),
    capillaryDamp: capillaryDampSignal(state),
    seepageDarkening: seepageDarkeningSignal(state),
    puddleCore: puddleCoreSignal(state),
    puddleEdge: puddleEdgeSignal(state, input.localContrast ?? .5),
    evaporationFront: evaporationFrontSignal(state),
    mineralCrust: mineralCrustSignal(state),
    fineSedimentFilm: fineSedimentFilmSignal(state),
    recoveryHalo: recoveryHaloSignal(state),
    freezeWetEdge: freezeWetEdgeSignal(state),
    marshTransition: marshTransitionSignal(state),
    dryingContrast: dryingContrastSignal(state),
    microRelief: microReliefSignal(state),
    surfaceConfidence: surfaceConfidenceSignal(state),
  });
  return freeze({
    policyId: TERRAIN_GROUNDWATER_DETAIL_POLICY.id,
    sourcePolicyId: TERRAIN_GROUNDWATER_POLICY.id,
    state,
    channels,
    canonical: freeze({ heightUnchanged: true, hydrologyUnchanged: true, coastlineUnchanged: true, colliderUnchanged: true, vegetationPlacementUnchanged: true, newGeographyIntroduced: false }),
  });
}

export function blendSurfaceDetail(a, b, mix = .5) {
  const t = clamp01(mix);
  const channels = {};
  for (const key of TERRAIN_GROUNDWATER_DETAIL_CHANNELS) channels[key] = lerp(clamp01(a.channels?.[key]), clamp01(b.channels?.[key]), t);
  return freeze({
    policyId: TERRAIN_GROUNDWATER_DETAIL_POLICY.id,
    sourcePolicyId: TERRAIN_GROUNDWATER_POLICY.id,
    channels: freeze(channels),
    canonical: freeze({ heightUnchanged: true, hydrologyUnchanged: true, coastlineUnchanged: true, colliderUnchanged: true, vegetationPlacementUnchanged: true, newGeographyIntroduced: false }),
  });
}

export function detailMaterialResponse(detail, baseColor = { r: .42, g: .36, b: .28 }, baseRoughness = .86) {
  const c = detail.channels;
  const wet = c.wetRim * .012 + c.seepageDarkening * .009 + c.puddleCore * .006;
  const crust = c.mineralCrust * .010 + c.evaporationFront * .004;
  const fine = c.fineSedimentFilm * .006;
  const color = freeze({
    r: clamp01(baseColor.r - wet * .72 + crust * .82 + fine * .35),
    g: clamp01(baseColor.g - wet * .54 + crust * .58 + fine * .24),
    b: clamp01(baseColor.b + wet * .31 + crust * .18 + fine * .16),
  });
  const roughness = clamp01(baseRoughness - c.puddleCore * .044 - c.wetRim * .021 + c.mineralCrust * .033 + c.dryingContrast * .018);
  const normalStrength = clamp01(c.microRelief * .024 + c.puddleEdge * .016 + c.freezeWetEdge * .015 + c.fineSedimentFilm * .010);
  const wetness = clamp01(c.puddleCore * .42 + c.wetRim * .26 + c.capillaryDamp * .20 + c.marshTransition * .12);
  return freeze({ color, roughness, normalStrength, wetness });
}

export function detailEventDelta(detail, event = {}) {
  const c = detail.channels;
  const type = typeof event.type === 'string' ? event.type : 'neutral';
  const intensity = clamp01(event.intensity ?? .5);
  const delta = { color: 0, roughness: 0, normal: 0, wetness: 0 };
  if (type === 'storm') { delta.color -= c.wetRim * .008 * intensity; delta.roughness -= c.puddleCore * .031 * intensity; delta.normal += c.seepageDarkening * .021 * intensity; delta.wetness += .06 * intensity; }
  if (type === 'drought') { delta.color += c.mineralCrust * .007 * intensity; delta.roughness += c.evaporationFront * .034 * intensity; delta.normal += c.dryingContrast * .010 * intensity; delta.wetness -= .06 * intensity; }
  if (type === 'freeze-thaw') { delta.color -= c.freezeWetEdge * .003 * intensity; delta.roughness += c.freezeWetEdge * .024 * intensity; delta.normal += c.microRelief * .026 * intensity; }
  if (type === 'snowmelt') { delta.color -= c.capillaryDamp * .004 * intensity; delta.roughness -= c.wetRim * .021 * intensity; delta.normal += c.puddleEdge * .010 * intensity; delta.wetness += .08 * intensity; }
  if (type === 'recovery') { delta.color -= c.recoveryHalo * .002 * intensity; delta.roughness -= c.recoveryHalo * .014 * intensity; delta.wetness += c.recoveryHalo * .025 * intensity; }
  return freeze(delta);
}

export function applyDetailEvent(material, delta = {}) {
  const base = material ?? { color: { r: .42, g: .36, b: .28 }, roughness: .86, normalStrength: 0, wetness: 0 };
  const color = freeze({
    r: clamp01(safe(base.color?.r, .42) + safe(delta.color) * .72),
    g: clamp01(safe(base.color?.g, .36) + safe(delta.color) * .56),
    b: clamp01(safe(base.color?.b, .28) + safe(delta.color) * .34),
  });
  return freeze({
    color,
    roughness: clamp01(safe(base.roughness, .86) + safe(delta.roughness)),
    normalStrength: clamp01(safe(base.normalStrength) + safe(delta.normal)),
    wetness: clamp01(safe(base.wetness) + safe(delta.wetness)),
  });
}

export function detailCanonicalAudit(detail) {
  const canonical = detail?.canonical ?? {};
  const failures = [];
  if (canonical.heightUnchanged !== true) failures.push('height');
  if (canonical.hydrologyUnchanged !== true) failures.push('hydrology');
  if (canonical.coastlineUnchanged !== true) failures.push('coastline');
  if (canonical.colliderUnchanged !== true) failures.push('collider');
  if (canonical.vegetationPlacementUnchanged !== true) failures.push('vegetation');
  if (canonical.newGeographyIntroduced !== false) failures.push('new-geography');
  return freeze({ ok: failures.length === 0, failures: freeze(failures), mutationCount: 0 });
}

export function detailSignature(detail) {
  const c = detail.channels;
  return freeze(Object.fromEntries(TERRAIN_GROUNDWATER_DETAIL_CHANNELS.map((key) => [key, Number(clamp01(c[key]).toFixed(6))])));
}

export function compareSurfaceDetails(a, b) {
  return freeze(Object.fromEntries(TERRAIN_GROUNDWATER_DETAIL_CHANNELS.map((key) => [key, Number((clamp01(b.channels?.[key]) - clamp01(a.channels?.[key])).toFixed(6))])));
}

export function surfaceDetailDistance(a, b) {
  let total = 0;
  for (const key of TERRAIN_GROUNDWATER_DETAIL_CHANNELS) {
    const delta = clamp01(a.channels?.[key]) - clamp01(b.channels?.[key]);
    total += delta * delta;
  }
  return Math.sqrt(total / TERRAIN_GROUNDWATER_DETAIL_CHANNELS.length);
}

export function classifySurfaceDetail(detail) {
  const c = detail.channels;
  if (c.puddleCore > .72 && c.wetRim > .58) return 'puddle-core';
  if (c.marshTransition > .72) return 'marsh-transition';
  if (c.seepageDarkening > .66) return 'seepage-band';
  if (c.mineralCrust > .64 && c.evaporationFront > .56) return 'evaporative-crust';
  if (c.capillaryDamp > .62) return 'capillary-damp';
  if (c.freezeWetEdge > .61) return 'freeze-wet-edge';
  if (c.dryingContrast > .72) return 'drying-front';
  if (c.wetRim > .48) return 'wet-rim';
  return 'neutral';
}

export function detailEnvelope(detail) {
  const errors = [];
  for (const key of TERRAIN_GROUNDWATER_DETAIL_CHANNELS) {
    const value = Number(detail.channels?.[key]);
    if (!Number.isFinite(value)) errors.push(`${key}:not-finite`);
    else if (value < 0 || value > 1) errors.push(`${key}:out-of-range`);
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}

export function detailWeightedWetness(detail) {
  const c = detail.channels;
  return clamp01(
    c.puddleCore * .28 +
    c.wetRim * .18 +
    c.capillaryDamp * .18 +
    c.seepageDarkening * .14 +
    c.marshTransition * .10 +
    c.recoveryHalo * .07 +
    c.freezeWetEdge * .05,
  );
}

export function detailDrynessRisk(detail) {
  const c = detail.channels;
  return clamp01(c.dryingContrast * .43 + c.evaporationFront * .26 + c.mineralCrust * .13 + (1 - c.recoveryHalo) * .18);
}

export function detailHydroBalance(detail) {
  return freeze({ wetness: detailWeightedWetness(detail), dryness: detailDrynessRisk(detail), net: Number((detailWeightedWetness(detail) - detailDrynessRisk(detail)).toFixed(6)) });
}

export function detailRenderTier(detail) {
  const confidence = clamp01(detail.channels.surfaceConfidence);
  const wet = detailWeightedWetness(detail);
  const dry = detailDrynessRisk(detail);
  if (confidence < .35) return 'suppressed';
  if (Math.max(wet, dry) >= .76) return 'high';
  if (Math.max(wet, dry) >= .52) return 'medium';
  return 'low';
}

export function detailTelemetry(input = {}) {
  const detail = resolveGroundwaterSurfaceDetail(input);
  return freeze({
    policyId: TERRAIN_GROUNDWATER_DETAIL_POLICY.id,
    sourcePolicyId: TERRAIN_GROUNDWATER_POLICY.id,
    signature: detailSignature(detail),
    classification: classifySurfaceDetail(detail),
    tier: detailRenderTier(detail),
    envelope: detailEnvelope(detail),
    canonical: detailCanonicalAudit(detail),
    hydroBalance: detailHydroBalance(detail),
  });
}

export function detailGrid({ originX = 0, originZ = 0, columns = 5, rows = 5, spacing = 24, sample = {} } = {}) {
  const result = [];
  const cols = Math.max(1, Math.min(40, Math.floor(columns)));
  const rowCount = Math.max(1, Math.min(40, Math.floor(rows)));
  for (let z = 0; z < rowCount; z += 1) {
    for (let x = 0; x < cols; x += 1) {
      const worldX = safe(originX) + x * safe(spacing);
      const worldZ = safe(originZ) + z * safe(spacing);
      const detail = resolveGroundwaterSurfaceDetail({ ...sample, worldX, worldZ });
      result.push(freeze({ x: worldX, z: worldZ, classification: classifySurfaceDetail(detail), wetness: detailWeightedWetness(detail), dryness: detailDrynessRisk(detail) }));
    }
  }
  return freeze(result);
}

export function detailNeighborhoodStats(details = []) {
  if (!Array.isArray(details) || details.length === 0) return freeze({ count: 0, wetMean: 0, wetMin: 0, wetMax: 0, dryMean: 0, dryMin: 0, dryMax: 0, contrast: 0 });
  const wet = details.map(detailWeightedWetness);
  const dry = details.map(detailDrynessRisk);
  const wetMean = wet.reduce((sum, value) => sum + value, 0) / wet.length;
  const dryMean = dry.reduce((sum, value) => sum + value, 0) / dry.length;
  const wetMin = Math.min(...wet);
  const wetMax = Math.max(...wet);
  const dryMin = Math.min(...dry);
  const dryMax = Math.max(...dry);
  return freeze({ count: details.length, wetMean, wetMin, wetMax, dryMean, dryMin, dryMax, contrast: Math.max(wetMax - wetMin, dryMax - dryMin) });
}

export const TERRAIN_GROUNDWATER_DETAIL_CANONICAL_INVARIANTS = freeze([
  'canonicalHeightUnchanged',
  'canonicalHydrologyUnchanged',
  'canonicalCoastlineUnchanged',
  'canonicalColliderUnchanged',
  'canonicalVegetationPlacementUnchanged',
  'newGeographyIntroduced:false',
]);
