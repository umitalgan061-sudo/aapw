import { assertWorldAssetSurfaceRealityContract, resolveWorldAssetSurfaceReality, surfaceRealityFingerprint } from '../src/3d/materials/worldAssetSurfaceReality.js';
import { assertHydrologySurfaceRealityContract, resolveHydrologySurfaceEvidence, resolveHydrologyMaterialResponse, hydrologySurfaceRealityFingerprint } from '../src/3d/world/hydrologySurfaceReality.js';
import { assertHydrometeoricSurfaceContract, resolveHydrometeoricSurfaceResponse, hydrometeoricSurfaceFingerprint } from '../src/3d/materials/worldMaterialHydrometeoricResponse.js';

const fail = (message) => {
  throw new Error(`[world-asset-surface-reality] ${message}`);
};

const finiteValues = (value) => {
  const values = [];
  const visit = (node, path = '') => {
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) values.push(path || 'value');
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) visit(child, path ? `${path}.${key}` : key);
  };
  visit(value);
  return values;
};

function checkSurfaceMatrix() {
  const probes = [
    { worldX: 0, worldZ: 0, profileId: 'stone', climateId: 'temperate', moisture: 0.52, slope: 0.16, seed: 11 },
    { worldX: 420, worldZ: -330, profileId: 'wood', climateId: 'coastal', salt: 0.54, moisture: 0.72, seed: 22 },
    { worldX: -740, worldZ: 880, profileId: 'metal', climateId: 'coastal', salt: 0.72, spray: 0.64, seed: 33 },
    { worldX: 1260, worldZ: 470, profileId: 'snow', climateId: 'glacial', frost: 0.94, snow: 0.91, seed: 44 },
    { worldX: -1370, worldZ: -910, profileId: 'soil', climateId: 'arid', dust: 0.78, moisture: 0.17, seed: 55 },
    { worldX: 2110, worldZ: -640, profileId: 'vegetation', climateId: 'wetland', moisture: 0.88, vegetation: 0.91, seed: 66 },
  ];
  const first = probes.map(resolveWorldAssetSurfaceReality);
  const second = probes.map((probe) => resolveWorldAssetSurfaceReality({ ...probe }));
  for (let i = 0; i < probes.length; i += 1) {
    const a = first[i];
    const b = second[i];
    if (surfaceRealityFingerprint(a) !== surfaceRealityFingerprint(b)) fail(`surface matrix nondeterministic at ${i}`);
    const nonFinite = finiteValues(a);
    if (nonFinite.length) fail(`surface matrix non-finite ${nonFinite[0]} at ${i}`);
    if (a.fabric.roughness < 0.18 || a.fabric.roughness > 1) fail(`roughness bound failure at ${i}`);
    if (a.fabric.normal < 0.015 || a.fabric.normal > 0.30) fail(`normal bound failure at ${i}`);
  }
  return { probeCount: probes.length, fingerprints: first.map(surfaceRealityFingerprint) };
}

function checkHydrologyMatrix() {
  const surfaces = [
    { waterType: 'ocean', distanceToWaterMeters: 12, wetEdge: 0.76 },
    { waterType: 'lake', distanceToWaterMeters: 18, waterDepthMeters: 2.4 },
    { waterType: 'river', distanceToWaterMeters: 5, riverProximity: 0.88 },
    { waterType: 'waterfall', distanceToWaterMeters: 3, spray: 0.94 },
    { waterType: 'frozen', distanceToWaterMeters: 7, coldWater: 0.98 },
    {},
  ];
  const outputs = surfaces.map((surface) => resolveHydrologyMaterialResponse({
    materialProfile: 'stone',
    evidence: resolveHydrologySurfaceEvidence(surface),
  }));
  const repeat = surfaces.map((surface) => resolveHydrologyMaterialResponse({
    materialProfile: 'stone',
    evidence: resolveHydrologySurfaceEvidence({ ...surface }),
  }));
  outputs.forEach((value, index) => {
    if (hydrologySurfaceRealityFingerprint(value) !== hydrologySurfaceRealityFingerprint(repeat[index])) fail(`hydrology nondeterministic at ${index}`);
    if (!validateObjectNumbers(value)) fail(`hydrology finite check failed at ${index}`);
  });
  if (!(outputs[2].response.sediment > outputs[0].response.sediment)) fail('river sediment should exceed ocean-edge sediment');
  if (!(outputs[3].response.spray >= outputs[2].response.spray)) fail('waterfall spray should exceed river spray');
  if (!(outputs[4].response.cold >= outputs[0].response.cold)) fail('frozen water cold response should exceed ocean edge');
  if (outputs[5].observedCanonicalWater) fail('missing canonical water observation must remain neutral');
  return { sampleCount: surfaces.length, fingerprints: outputs.map(hydrologySurfaceRealityFingerprint) };
}

function validateObjectNumbers(value) {
  const bad = finiteValues(value);
  return bad.length === 0;
}

function checkHydrometeoricMatrix() {
  const states = [
    { profileId: 'stone', state: { precipitation: 0.72, wetEdge: 0.82, runoff: 0.66, humidity: 0.86, solar: 0.32, wind: 0.44 } },
    { profileId: 'wood', state: { rain: 0.92, humidity: 0.88, wind: 0.62, solar: 0.28 } },
    { profileId: 'metal', state: { wetEdge: 0.68, salt: 0.80, wind: 0.74, solar: 0.60 } },
    { profileId: 'snow', state: { snow: 0.96, snowPersistence: 0.94, temperature: 0.08, humidity: 0.84, wind: 0.78 } },
    { profileId: 'soil', state: { rain: 0.90, pooling: 0.84, slope: 0.04, sediment: 0.76, solar: 0.18 } },
  ];
  const first = states.map((probe) => resolveHydrometeoricSurfaceResponse(probe));
  const second = states.map((probe) => resolveHydrometeoricSurfaceResponse({ ...probe }));
  first.forEach((response, index) => {
    if (hydrometeoricSurfaceFingerprint(response) !== hydrometeoricSurfaceFingerprint(second[index])) fail(`hydrometeoric nondeterministic at ${index}`);
    if (!response.diagnostics.finite) fail(`hydrometeoric non-finite diagnostics at ${index}`);
    if (response.finish.roughness < 0.10 || response.finish.roughness > 1) fail(`hydrometeoric roughness bound at ${index}`);
    if (response.finish.normal < 0.010 || response.finish.normal > 0.26) fail(`hydrometeoric normal bound at ${index}`);
  });
  return { sampleCount: states.length, fingerprints: first.map(hydrometeoricSurfaceFingerprint) };
}

function checkCrossLayerEnvelope() {
  const base = resolveWorldAssetSurfaceReality({
    worldX: 840,
    worldZ: -520,
    profileId: 'stone',
    climateId: 'coastal',
    moisture: 0.78,
    salt: 0.62,
    wetEdge: 0.72,
    slope: 0.42,
    seed: 9191,
  });
  const hydroEvidence = resolveHydrologySurfaceEvidence({
    waterType: 'ocean',
    distanceToWaterMeters: 16,
    wetEdge: 0.72,
    spray: 0.52,
  });
  const hydro = resolveHydrologyMaterialResponse({ materialProfile: 'stone', evidence: hydroEvidence });
  const state = {
    wetEdge: hydro.response.wet,
    spray: hydro.response.spray,
    salt: hydro.response.salt,
    sediment: hydro.response.sediment,
    frost: hydro.response.cold,
    exposure: base.context.exposure,
    shelter: base.context.shelter,
    slope: base.context.slope,
  };
  const weather = resolveHydrometeoricSurfaceResponse({ profileId: base.profileId, state, seed: base.seed });
  if (!weather.diagnostics.finite) fail('cross-layer hydrometeoric response is not finite');
  if (!(weather.finish.wet >= hydro.response.wet * 0.5)) fail('hydrology-to-weather wetness coupling collapsed');
  return {
    baseFingerprint: surfaceRealityFingerprint(base),
    hydrologyFingerprint: hydrologySurfaceRealityFingerprint(hydro),
    weatherFingerprint: hydrometeoricSurfaceFingerprint(weather),
  };
}

assertWorldAssetSurfaceRealityContract();
assertHydrologySurfaceRealityContract();
assertHydrometeoricSurfaceContract();

const report = {
  surface: checkSurfaceMatrix(),
  hydrology: checkHydrologyMatrix(),
  hydrometeoric: checkHydrometeoricMatrix(),
  crossLayer: checkCrossLayerEnvelope(),
};

console.log(JSON.stringify({
  WORLD_ASSET_SURFACE_REALITY_OK: true,
  policy: 'world-asset-surface-reality-2026-09-14-v1',
  hydrologyPolicy: 'hydrology-surface-reality-2026-09-14-v1',
  hydrometeoricPolicy: 'world-hydrometeoric-surface-response-2026-09-14-v1',
  report,
}, null, 2));
