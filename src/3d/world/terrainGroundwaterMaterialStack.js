/**
 * Render-only facade for composing groundwater presentation with the terrain
 * surface stack. The facade intentionally consumes existing signals and never
 * becomes authoritative for height, water topology, colliders, navigation,
 * coastline placement, or vegetation placement.
 */
import { TERRAIN_GROUNDWATER_POLICY, resolveTerrainGroundwaterState } from './terrainGroundwaterRegime.js';
import { TERRAIN_GROUNDWATER_ADAPTER_POLICY, resolveGroundwaterSurfaceFrame, blendGroundwaterFrames, accumulateGroundwaterNeighborhood, applyGroundwaterBudget } from './terrainGroundwaterSurfaceAdapter.js';
import { installTerrainGroundwaterShader, TERRAIN_GROUNDWATER_SHADER_POLICY } from './terrainGroundwaterShader.js';

const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
const lerp = (a, b, t) => a + (b - a) * t;
const freeze = Object.freeze;

export const TERRAIN_GROUNDWATER_STACK_POLICY = freeze({
  id: 'terrain-groundwater-material-stack-2026-09-15-v1',
  sourcePolicyId: TERRAIN_GROUNDWATER_POLICY.id,
  adapterPolicyId: TERRAIN_GROUNDWATER_ADAPTER_POLICY.id,
  shaderPolicyId: TERRAIN_GROUNDWATER_SHADER_POLICY.id,
  renderOnly: true,
  deterministic: true,
  canonicalHeightUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalCoastlineUnchanged: true,
  canonicalColliderUnchanged: true,
  canonicalVegetationPlacementUnchanged: true,
  newGeographyIntroduced: false,
  stageCount: 9,
});

const DEFAULT_LAYER_ORDER = freeze([
  'base-terrain',
  'sediment',
  'soil-structure',
  'seasonality',
  'climate-exposure',
  'wind-drying',
  'thermal-microclimate',
  'groundwater',
  'material-budget',
]);

export const TERRAIN_GROUNDWATER_DEFAULT_LAYER_ORDER = DEFAULT_LAYER_ORDER;

const safe = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;

export function stackLayerOrder(customOrder = []) {
  const requested = Array.isArray(customOrder) ? customOrder.filter((v) => typeof v === 'string' && v.length) : [];
  const known = new Set(DEFAULT_LAYER_ORDER);
  const result = [];
  for (const key of requested) if (known.has(key) && !result.includes(key)) result.push(key);
  for (const key of DEFAULT_LAYER_ORDER) if (!result.includes(key)) result.push(key);
  return freeze(result);
}

export function stackPolicyManifest() {
  return freeze({
    policyId: TERRAIN_GROUNDWATER_STACK_POLICY.id,
    sourcePolicyId: TERRAIN_GROUNDWATER_POLICY.id,
    adapterPolicyId: TERRAIN_GROUNDWATER_ADAPTER_POLICY.id,
    shaderPolicyId: TERRAIN_GROUNDWATER_SHADER_POLICY.id,
    layerOrder: DEFAULT_LAYER_ORDER,
    canonical: freeze({
      heightUnchanged: true,
      hydrologyUnchanged: true,
      coastlineUnchanged: true,
      colliderUnchanged: true,
      vegetationPlacementUnchanged: true,
      newGeographyIntroduced: false,
    }),
  });
}

function materialDefaults(baseMaterial = {}) {
  return freeze({
    color: freeze({ r: clamp01(safe(baseMaterial.color?.r, .5)), g: clamp01(safe(baseMaterial.color?.g, .42)), b: clamp01(safe(baseMaterial.color?.b, .32)) }),
    roughness: clamp(safe(baseMaterial.roughness, .86), 0, 1),
    normalStrength: clamp(safe(baseMaterial.normalStrength, 0), 0, 1),
    wetness: clamp01(safe(baseMaterial.wetness, 0)),
  });
}

export function composeGroundwaterMaterial(baseMaterial = {}, frame, options = {}) {
  const base = materialDefaults(baseMaterial);
  const sourceFrame = frame ?? resolveGroundwaterSurfaceFrame(options.input ?? {});
  const groundwater = sourceFrame.material;
  const weight = clamp01(options.weight ?? 1);
  const color = freeze({
    r: lerp(base.color.r, groundwater.color.r, weight),
    g: lerp(base.color.g, groundwater.color.g, weight),
    b: lerp(base.color.b, groundwater.color.b, weight),
  });
  const roughness = lerp(base.roughness, groundwater.roughness, weight);
  const normalStrength = clamp01(lerp(base.normalStrength, groundwater.normalStrength, weight));
  const wetness = clamp01(lerp(base.wetness, groundwater.wetness, weight));
  return freeze({ color, roughness, normalStrength, wetness });
}

export function combineNeighborGroundwater(baseMaterial, centerFrame, neighborFrames = [], options = {}) {
  const neighborhood = accumulateGroundwaterNeighborhood([centerFrame, ...neighborFrames]);
  const sharpened = options.sharpen === false ? centerFrame : (() => {
    const edge = clamp01(neighborhood.edgeContrast * (options.edgeStrength ?? .35));
    const channels = { ...centerFrame.channels, wetness: clamp01(centerFrame.channels.wetness + edge * .08), surfaceFilm: clamp01(centerFrame.channels.surfaceFilm + edge * .05), saturation: clamp01(centerFrame.channels.saturation + edge * .04) };
    return freeze({ ...centerFrame, channels: freeze(channels) });
  })();
  return freeze({ material: composeGroundwaterMaterial(baseMaterial, sharpened, options), neighborhood, frame: sharpened });
}

export function temporalGroundwaterBlend(inputs = [], mix = .5) {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new RangeError('groundwater temporal blend requires at least one frame');
  if (inputs.length === 1) return inputs[0];
  const t = clamp01(mix);
  let left = inputs[0];
  for (let index = 1; index < inputs.length; index += 1) left = blendGroundwaterFrames(left, inputs[index], t);
  return left;
}

export function resolveGroundwaterStackFrame(input = {}, baseMaterial = {}, options = {}) {
  const frame = resolveGroundwaterSurfaceFrame({ ...input, ...options.sampleOverrides });
  const weighted = composeGroundwaterMaterial(baseMaterial, frame, { weight: options.groundwaterWeight ?? 1 });
  const budgeted = applyGroundwaterBudget({ ...frame, material: weighted }, options.budget);
  return freeze({
    policyId: TERRAIN_GROUNDWATER_STACK_POLICY.id,
    sourcePolicyId: TERRAIN_GROUNDWATER_POLICY.id,
    frame,
    state: frame.state,
    material: budgeted.material,
    layerOrder: stackLayerOrder(options.layerOrder),
    canonical: budgeted.canonical,
  });
}

export function installGroundwaterMaterialStack(material, options = {}) {
  const installed = installTerrainGroundwaterShader(material);
  installed.userData = {
    ...installed.userData,
    terrainGroundwaterStackInstalled: true,
    terrainGroundwaterStackPolicyId: TERRAIN_GROUNDWATER_STACK_POLICY.id,
    terrainGroundwaterStackLayerOrder: [...stackLayerOrder(options.layerOrder)],
    terrainGroundwaterStackRenderOnly: true,
    terrainGroundwaterStackCanonicalHeightUnchanged: true,
    terrainGroundwaterStackCanonicalHydrologyUnchanged: true,
    terrainGroundwaterStackCanonicalCoastlineUnchanged: true,
    terrainGroundwaterStackCanonicalColliderUnchanged: true,
    terrainGroundwaterStackCanonicalVegetationPlacementUnchanged: true,
  };
  return installed;
}

export function stackAudit(frame) {
  const state = frame?.state;
  const channels = frame?.channels;
  const errors = [];
  if (!state || state.policyId !== TERRAIN_GROUNDWATER_POLICY.id) errors.push('state-policy');
  if (!channels) errors.push('channels-missing');
  if (channels) for (const [key, value] of Object.entries(channels)) if (!Number.isFinite(value) || value < 0 || value > 1) errors.push(`channel:${key}`);
  if (frame?.canonical?.heightUnchanged !== true) errors.push('height-mutation');
  if (frame?.canonical?.hydrologyUnchanged !== true) errors.push('hydrology-mutation');
  if (frame?.canonical?.coastlineUnchanged !== true) errors.push('coastline-mutation');
  if (frame?.canonical?.colliderUnchanged !== true) errors.push('collider-mutation');
  if (frame?.canonical?.vegetationPlacementUnchanged !== true) errors.push('vegetation-mutation');
  return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}

export function compareStackFrames(a, b) {
  const keys = ['wetness','surfaceFilm','waterTableProximity','capillaryRise','seepageFace','saturation','memory','dryingResistance','puddlePersistence','marshEdge','fineTransport','saltRing','freezeWetness','dryingDemand'];
  const delta = {};
  for (const key of keys) delta[key] = Number((safe(b?.channels?.[key]) - safe(a?.channels?.[key])).toFixed(6));
  return freeze(delta);
}

export function stackVisualWeight(frame, { wetness = .35, saturation = .25, seepage = .15, capillary = .1, puddle = .1, marsh = .05 } = {}) {
  const channels = frame.channels;
  return clamp01(
    safe(channels.wetness) * wetness +
    safe(channels.saturation) * saturation +
    safe(channels.seepageFace) * seepage +
    safe(channels.capillaryRise) * capillary +
    safe(channels.puddlePersistence) * puddle +
    safe(channels.marshEdge) * marsh,
  );
}

export function stackEventResponse(frame, event = {}) {
  const type = typeof event.type === 'string' ? event.type : 'neutral';
  const intensity = clamp01(event.intensity ?? .5);
  const channels = frame.channels;
  const response = { albedo: 0, roughness: 0, normal: 0, wetness: 0 };
  if (type === 'storm') { response.albedo -= intensity * channels.wetness * .028; response.roughness -= intensity * channels.surfaceFilm * .075; response.normal += intensity * channels.seepageFace * .045; response.wetness += intensity * .12; }
  if (type === 'drought') { response.albedo += intensity * channels.saltRing * .018; response.roughness += intensity * channels.dryingDemand * .06; response.normal += intensity * channels.puddlePersistence * .012; response.wetness -= intensity * .14; }
  if (type === 'freeze-thaw') { response.albedo += intensity * channels.freezeWetness * .008; response.roughness += intensity * channels.freezeWetness * .038; response.normal += intensity * channels.freezeWetness * .052; }
  if (type === 'snowmelt') { response.albedo -= intensity * channels.surfaceFilm * .016; response.roughness -= intensity * channels.surfaceFilm * .045; response.normal += intensity * channels.seepageFace * .026; response.wetness += intensity * .16; }
  if (type === 'recovery') { response.roughness -= intensity * channels.memory * .018; response.wetness += intensity * channels.memory * .04; }
  return freeze(response);
}

export function applyStackEvent(material, response) {
  const base = materialDefaults(material);
  const delta = response ?? {};
  return freeze({
    color: freeze({ r: clamp01(base.color.r + safe(delta.albedo) * .7), g: clamp01(base.color.g + safe(delta.albedo) * .9), b: clamp01(base.color.b + safe(delta.albedo) * 1.2) }),
    roughness: clamp01(base.roughness + safe(delta.roughness)),
    normalStrength: clamp01(base.normalStrength + safe(delta.normal)),
    wetness: clamp01(base.wetness + safe(delta.wetness)),
  });
}

export function stackEventFrame(frame, event = {}) {
  const response = stackEventResponse(frame, event);
  return freeze({ ...frame, material: applyStackEvent(frame.material, response), event: freeze({ type: event.type ?? 'neutral', intensity: clamp01(event.intensity ?? .5), response }) });
}

export function stackBatch(inputs = [], options = {}) {
  if (!Array.isArray(inputs)) throw new TypeError('groundwater batch requires an array');
  return freeze(inputs.map((input) => resolveGroundwaterStackFrame(input, options.baseMaterial, options)));
}

export function stackStats(frames = []) {
  if (!Array.isArray(frames) || frames.length === 0) return freeze({ count: 0, meanWetness: 0, meanSaturation: 0, meanFilm: 0, meanSeepage: 0, minWetness: 0, maxWetness: 0 });
  let wet = 0;
  let sat = 0;
  let film = 0;
  let seep = 0;
  let minWet = Infinity;
  let maxWet = -Infinity;
  for (const frame of frames) {
    wet += safe(frame.frame?.channels?.wetness ?? frame.channels?.wetness);
    sat += safe(frame.frame?.channels?.saturation ?? frame.channels?.saturation);
    film += safe(frame.frame?.channels?.surfaceFilm ?? frame.channels?.surfaceFilm);
    seep += safe(frame.frame?.channels?.seepageFace ?? frame.channels?.seepageFace);
    minWet = Math.min(minWet, safe(frame.frame?.channels?.wetness ?? frame.channels?.wetness));
    maxWet = Math.max(maxWet, safe(frame.frame?.channels?.wetness ?? frame.channels?.wetness));
  }
  return freeze({ count: frames.length, meanWetness: wet / frames.length, meanSaturation: sat / frames.length, meanFilm: film / frames.length, meanSeepage: seep / frames.length, minWetness: minWet, maxWetness: maxWet });
}

export function stackSignature(input = {}, baseMaterial = {}, options = {}) {
  const result = resolveGroundwaterStackFrame(input, baseMaterial, options);
  const channels = result.frame.channels;
  return freeze({ policyId: result.policyId, wetness: Number(channels.wetness.toFixed(6)), saturation: Number(channels.saturation.toFixed(6)), seepage: Number(channels.seepageFace.toFixed(6)), capillary: Number(channels.capillaryRise.toFixed(6)), puddle: Number(channels.puddlePersistence.toFixed(6)), marsh: Number(channels.marshEdge.toFixed(6)), roughness: Number(result.material.roughness.toFixed(6)), normal: Number(result.material.normalStrength.toFixed(6)) });
}

export function stackCanonicalInvariantReport(frame) {
  return freeze({
    heightUnchanged: frame?.canonical?.heightUnchanged === true,
    hydrologyUnchanged: frame?.canonical?.hydrologyUnchanged === true,
    coastlineUnchanged: frame?.canonical?.coastlineUnchanged === true,
    colliderUnchanged: frame?.canonical?.colliderUnchanged === true,
    vegetationPlacementUnchanged: frame?.canonical?.vegetationPlacementUnchanged === true,
    newGeographyIntroduced: frame?.canonical?.newGeographyIntroduced === false,
  });
}

export function groundwaterStackRecipe({ includeShader = true, layerOrder = DEFAULT_LAYER_ORDER } = {}) {
  return freeze({
    policyId: TERRAIN_GROUNDWATER_STACK_POLICY.id,
    layerOrder: stackLayerOrder(layerOrder),
    installShader: Boolean(includeShader),
    stages: freeze([
      freeze({ id: 'sample', output: 'normalized-environment-input' }),
      freeze({ id: 'field', output: 'deterministic-groundwater-field' }),
      freeze({ id: 'regime', output: 'water-table-and-capillary-signals' }),
      freeze({ id: 'surface', output: 'surface-film-and-puddle-signals' }),
      freeze({ id: 'minerals', output: 'fine-transport-and-salt-ring-signals' }),
      freeze({ id: 'adapter', output: 'material-channels' }),
      freeze({ id: 'shader', output: 'bounded-fragment-response' }),
      freeze({ id: 'budget', output: 'bounded-material-response' }),
      freeze({ id: 'audit', output: 'canonical-invariant-report' }),
    ]),
  });
}

export function stackFrameFromState(state, baseMaterial = {}, options = {}) {
  const frame = resolveGroundwaterSurfaceFrame(state?.sample ?? state ?? {});
  const material = composeGroundwaterMaterial(baseMaterial, frame, options);
  return freeze({ ...frame, material });
}

export function stackInterpolation(aInput, bInput, mix = .5, baseMaterial = {}, options = {}) {
  const a = resolveGroundwaterSurfaceFrame(aInput);
  const b = resolveGroundwaterSurfaceFrame(bInput);
  const blended = blendGroundwaterFrames(a, b, clamp01(mix));
  return freeze({ ...blended, material: composeGroundwaterMaterial(baseMaterial, blended, options) });
}

export function stackDistance(aInput, bInput) {
  const a = resolveGroundwaterSurfaceFrame(aInput);
  const b = resolveGroundwaterSurfaceFrame(bInput);
  const keys = Object.keys(a.channels);
  let sum = 0;
  for (const key of keys) { const delta = a.channels[key] - b.channels[key]; sum += delta * delta; }
  return Math.sqrt(sum / Math.max(keys.length, 1));
}

export function stackMaterialDelta(before, after) {
  return freeze({
    red: safe(after.color?.r) - safe(before.color?.r),
    green: safe(after.color?.g) - safe(before.color?.g),
    blue: safe(after.color?.b) - safe(before.color?.b),
    roughness: safe(after.roughness) - safe(before.roughness),
    normalStrength: safe(after.normalStrength) - safe(before.normalStrength),
    wetness: safe(after.wetness) - safe(before.wetness),
  });
}
