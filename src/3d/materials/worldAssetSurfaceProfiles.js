/**
 * Material-family realism profiles shared by placed world assets.
 *
 * Profiles intentionally describe response, not geography. They are selected from semantic asset /
 * material names and then modulated by the read-only world ecology field. Authored maps, UVs and
 * mesh geometry remain authoritative.
 */

export const WORLD_ASSET_SURFACE_PROFILES_REVISION = 'v1-family-specific-weathering-and-fabric';

export const WORLD_ASSET_SURFACE_PROFILES_POLICY = Object.freeze({
  id: 'world-asset-surface-profiles-2026-09-03-v1',
  renderOnly: true,
  deterministic: true,
  authoredMapsPreserved: true,
  authoredUvsPreserved: true,
  geometryUnchanged: true,
  placementUnchanged: true,
  canonicalTerrainUnchanged: true,
  canonicalHydrologyUnchanged: true,
  profileSpecificWorldScales: true,
  independentAlbedoRoughnessNormalDomains: true,
  anisotropicRockStrata: true,
  anisotropicWoodGrain: true,
  canopyMottle: true,
  coastalSaltWeathering: true,
  foundationDampWeathering: true,
});

const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const freeze = (value) => Object.freeze(value);

function profile(id, family, data) {
  return freeze({
    id,
    family,
    ...data,
  });
}

export const WORLD_ASSET_SURFACE_PROFILES = freeze({
  graniteCliff: profile('granite-cliff', 'rock', {
    macroScale: 118, mesoScale: 24, fineScale: 3.6,
    albedoMacro: 0.115, albedoMeso: 0.084, albedoFine: 0.026,
    roughnessBase: 0.86, roughnessMacro: 0.15, roughnessFine: 0.075,
    normalMacro: 0.115, normalFine: 0.075,
    strataStrength: 0.16, strataFrequency: 0.095, strataVerticalBias: 0.38,
    fractureStrength: 0.20, fractureScale: 8.8,
    lichenAffinity: 0.44, mossAffinity: 0.18,
    dampDarken: 0.15, exposedBleach: 0.055, frostBleach: 0.07,
    oxidationAffinity: 0.07, saltAffinity: 0.04,
  }),
  basaltCliff: profile('basalt-cliff', 'rock', {
    macroScale: 96, mesoScale: 18, fineScale: 2.9,
    albedoMacro: 0.095, albedoMeso: 0.072, albedoFine: 0.022,
    roughnessBase: 0.82, roughnessMacro: 0.17, roughnessFine: 0.08,
    normalMacro: 0.14, normalFine: 0.082,
    strataStrength: 0.12, strataFrequency: 0.12, strataVerticalBias: 0.62,
    fractureStrength: 0.24, fractureScale: 6.5,
    lichenAffinity: 0.34, mossAffinity: 0.16,
    dampDarken: 0.19, exposedBleach: 0.035, frostBleach: 0.055,
    oxidationAffinity: 0.05, saltAffinity: 0.08,
  }),
  slateRidge: profile('slate-ridge', 'rock', {
    macroScale: 82, mesoScale: 15, fineScale: 2.4,
    albedoMacro: 0.085, albedoMeso: 0.082, albedoFine: 0.025,
    roughnessBase: 0.84, roughnessMacro: 0.13, roughnessFine: 0.08,
    normalMacro: 0.13, normalFine: 0.09,
    strataStrength: 0.25, strataFrequency: 0.16, strataVerticalBias: 0.20,
    fractureStrength: 0.18, fractureScale: 5.7,
    lichenAffinity: 0.40, mossAffinity: 0.13,
    dampDarken: 0.17, exposedBleach: 0.045, frostBleach: 0.08,
    oxidationAffinity: 0.035, saltAffinity: 0.04,
  }),
  talusStone: profile('talus-stone', 'rock', {
    macroScale: 55, mesoScale: 12, fineScale: 2.0,
    albedoMacro: 0.13, albedoMeso: 0.095, albedoFine: 0.035,
    roughnessBase: 0.91, roughnessMacro: 0.11, roughnessFine: 0.085,
    normalMacro: 0.16, normalFine: 0.11,
    strataStrength: 0.09, strataFrequency: 0.11, strataVerticalBias: 0.18,
    fractureStrength: 0.27, fractureScale: 4.2,
    lichenAffinity: 0.24, mossAffinity: 0.09,
    dampDarken: 0.13, exposedBleach: 0.07, frostBleach: 0.075,
    oxidationAffinity: 0.08, saltAffinity: 0.035,
  }),
  riverStone: profile('river-stone', 'rock', {
    macroScale: 48, mesoScale: 9.5, fineScale: 1.7,
    albedoMacro: 0.105, albedoMeso: 0.075, albedoFine: 0.024,
    roughnessBase: 0.72, roughnessMacro: 0.15, roughnessFine: 0.065,
    normalMacro: 0.075, normalFine: 0.055,
    strataStrength: 0.05, strataFrequency: 0.09, strataVerticalBias: 0.10,
    fractureStrength: 0.10, fractureScale: 5.2,
    lichenAffinity: 0.18, mossAffinity: 0.22,
    dampDarken: 0.23, exposedBleach: 0.03, frostBleach: 0.04,
    oxidationAffinity: 0.035, saltAffinity: 0.03,
  }),
  exposedSoil: profile('exposed-soil', 'soil', {
    macroScale: 76, mesoScale: 16, fineScale: 2.3,
    albedoMacro: 0.14, albedoMeso: 0.105, albedoFine: 0.035,
    roughnessBase: 0.94, roughnessMacro: 0.105, roughnessFine: 0.075,
    normalMacro: 0.09, normalFine: 0.105,
    sedimentStrength: 0.17, sedimentFrequency: 0.13,
    pebbleStrength: 0.12, rootDisturbance: 0.08,
    dampDarken: 0.21, dryBleach: 0.07, oxidationAffinity: 0.13,
    mossAffinity: 0.05, saltAffinity: 0.035,
  }),
  mud: profile('mud', 'soil', {
    macroScale: 52, mesoScale: 11, fineScale: 1.9,
    albedoMacro: 0.115, albedoMeso: 0.085, albedoFine: 0.025,
    roughnessBase: 0.77, roughnessMacro: 0.16, roughnessFine: 0.07,
    normalMacro: 0.06, normalFine: 0.075,
    sedimentStrength: 0.22, sedimentFrequency: 0.17,
    pebbleStrength: 0.055, rootDisturbance: 0.12,
    dampDarken: 0.27, dryBleach: 0.035, oxidationAffinity: 0.07,
    mossAffinity: 0.08, saltAffinity: 0.045,
  }),
  roadEarth: profile('road-earth', 'soil', {
    macroScale: 62, mesoScale: 13, fineScale: 1.7,
    albedoMacro: 0.105, albedoMeso: 0.09, albedoFine: 0.03,
    roughnessBase: 0.90, roughnessMacro: 0.12, roughnessFine: 0.095,
    normalMacro: 0.07, normalFine: 0.085,
    sedimentStrength: 0.11, sedimentFrequency: 0.09,
    pebbleStrength: 0.14, rootDisturbance: 0.02,
    dampDarken: 0.19, dryBleach: 0.09, oxidationAffinity: 0.08,
    mossAffinity: 0.015, saltAffinity: 0.02,
  }),
  deciduousLeaf: profile('deciduous-leaf', 'foliage', {
    macroScale: 33, mesoScale: 8.5, fineScale: 1.15,
    albedoMacro: 0.10, albedoMeso: 0.085, albedoFine: 0.035,
    roughnessBase: 0.78, roughnessMacro: 0.115, roughnessFine: 0.08,
    normalMacro: 0.035, normalFine: 0.055,
    chlorophyllVariation: 0.17, canopyMottle: 0.21,
    senescenceAffinity: 0.13, wetLeafDarken: 0.16,
    frostBleach: 0.06, saltAffinity: 0.025,
  }),
  coniferNeedle: profile('conifer-needle', 'foliage', {
    macroScale: 41, mesoScale: 9.5, fineScale: 1.35,
    albedoMacro: 0.09, albedoMeso: 0.07, albedoFine: 0.028,
    roughnessBase: 0.80, roughnessMacro: 0.10, roughnessFine: 0.075,
    normalMacro: 0.04, normalFine: 0.05,
    chlorophyllVariation: 0.13, canopyMottle: 0.17,
    senescenceAffinity: 0.06, wetLeafDarken: 0.14,
    frostBleach: 0.055, saltAffinity: 0.02,
  }),
  grassBlade: profile('grass-blade', 'foliage', {
    macroScale: 27, mesoScale: 6.2, fineScale: 0.95,
    albedoMacro: 0.12, albedoMeso: 0.09, albedoFine: 0.032,
    roughnessBase: 0.86, roughnessMacro: 0.105, roughnessFine: 0.07,
    normalMacro: 0.03, normalFine: 0.045,
    chlorophyllVariation: 0.19, canopyMottle: 0.22,
    senescenceAffinity: 0.19, wetLeafDarken: 0.13,
    frostBleach: 0.07, saltAffinity: 0.025,
  }),
  shrubLeaf: profile('shrub-leaf', 'foliage', {
    macroScale: 29, mesoScale: 7.4, fineScale: 1.1,
    albedoMacro: 0.11, albedoMeso: 0.085, albedoFine: 0.034,
    roughnessBase: 0.83, roughnessMacro: 0.11, roughnessFine: 0.075,
    normalMacro: 0.04, normalFine: 0.052,
    chlorophyllVariation: 0.15, canopyMottle: 0.20,
    senescenceAffinity: 0.15, wetLeafDarken: 0.15,
    frostBleach: 0.065, saltAffinity: 0.03,
  }),
  treeBark: profile('tree-bark', 'wood', {
    macroScale: 38, mesoScale: 7.5, fineScale: 0.78,
    albedoMacro: 0.10, albedoMeso: 0.09, albedoFine: 0.04,
    roughnessBase: 0.90, roughnessMacro: 0.095, roughnessFine: 0.085,
    normalMacro: 0.07, normalFine: 0.12,
    grainStrength: 0.26, grainFrequency: 0.31, ringStrength: 0.05,
    crackStrength: 0.17, dampDarken: 0.17,
    mossAffinity: 0.16, lichenAffinity: 0.14, sunBleach: 0.035,
  }),
  structuralTimber: profile('structural-timber', 'wood', {
    macroScale: 46, mesoScale: 10, fineScale: 0.9,
    albedoMacro: 0.085, albedoMeso: 0.075, albedoFine: 0.033,
    roughnessBase: 0.80, roughnessMacro: 0.12, roughnessFine: 0.085,
    normalMacro: 0.045, normalFine: 0.075,
    grainStrength: 0.22, grainFrequency: 0.28, ringStrength: 0.07,
    crackStrength: 0.11, dampDarken: 0.16,
    mossAffinity: 0.055, lichenAffinity: 0.04, sunBleach: 0.07,
  }),
  weatheredPlank: profile('weathered-plank', 'wood', {
    macroScale: 39, mesoScale: 8.5, fineScale: 0.82,
    albedoMacro: 0.10, albedoMeso: 0.085, albedoFine: 0.037,
    roughnessBase: 0.87, roughnessMacro: 0.11, roughnessFine: 0.09,
    normalMacro: 0.055, normalFine: 0.085,
    grainStrength: 0.24, grainFrequency: 0.30, ringStrength: 0.06,
    crackStrength: 0.16, dampDarken: 0.17,
    mossAffinity: 0.06, lichenAffinity: 0.045, sunBleach: 0.095,
  }),
  masonryStone: profile('masonry-stone', 'masonry', {
    macroScale: 71, mesoScale: 14, fineScale: 1.8,
    albedoMacro: 0.095, albedoMeso: 0.075, albedoFine: 0.025,
    roughnessBase: 0.87, roughnessMacro: 0.12, roughnessFine: 0.065,
    normalMacro: 0.06, normalFine: 0.075,
    mortarStain: 0.18, dripStrength: 0.17, foundationDamp: 0.22,
    saltBloom: 0.08, lichenAffinity: 0.12, mossAffinity: 0.09,
    exposedBleach: 0.055,
  }),
  limePlaster: profile('lime-plaster', 'masonry', {
    macroScale: 84, mesoScale: 17, fineScale: 2.1,
    albedoMacro: 0.075, albedoMeso: 0.055, albedoFine: 0.018,
    roughnessBase: 0.83, roughnessMacro: 0.10, roughnessFine: 0.045,
    normalMacro: 0.025, normalFine: 0.045,
    mortarStain: 0.11, dripStrength: 0.20, foundationDamp: 0.18,
    saltBloom: 0.11, lichenAffinity: 0.035, mossAffinity: 0.025,
    exposedBleach: 0.085,
  }),
  firedBrick: profile('fired-brick', 'masonry', {
    macroScale: 59, mesoScale: 12, fineScale: 1.5,
    albedoMacro: 0.08, albedoMeso: 0.065, albedoFine: 0.02,
    roughnessBase: 0.86, roughnessMacro: 0.11, roughnessFine: 0.055,
    normalMacro: 0.045, normalFine: 0.06,
    mortarStain: 0.14, dripStrength: 0.15, foundationDamp: 0.19,
    saltBloom: 0.075, lichenAffinity: 0.055, mossAffinity: 0.045,
    exposedBleach: 0.045,
  }),
  thatch: profile('thatch', 'roof', {
    macroScale: 31, mesoScale: 6.5, fineScale: 0.72,
    albedoMacro: 0.11, albedoMeso: 0.09, albedoFine: 0.04,
    roughnessBase: 0.94, roughnessMacro: 0.08, roughnessFine: 0.055,
    normalMacro: 0.06, normalFine: 0.10,
    fiberStrength: 0.28, fiberFrequency: 0.36,
    wetDarken: 0.17, dryBleach: 0.095, mossAffinity: 0.09,
  }),
  roofTile: profile('roof-tile', 'roof', {
    macroScale: 43, mesoScale: 8.5, fineScale: 1.0,
    albedoMacro: 0.085, albedoMeso: 0.065, albedoFine: 0.02,
    roughnessBase: 0.82, roughnessMacro: 0.13, roughnessFine: 0.055,
    normalMacro: 0.045, normalFine: 0.052,
    fiberStrength: 0.02, fiberFrequency: 0.08,
    wetDarken: 0.16, dryBleach: 0.045, mossAffinity: 0.10,
  }),
  oxidisedIron: profile('oxidised-iron', 'metal', {
    macroScale: 36, mesoScale: 7.2, fineScale: 0.82,
    albedoMacro: 0.075, albedoMeso: 0.07, albedoFine: 0.025,
    roughnessBase: 0.67, roughnessMacro: 0.19, roughnessFine: 0.12,
    normalMacro: 0.035, normalFine: 0.055,
    oxidationAffinity: 0.34, streakStrength: 0.22, saltAffinity: 0.14,
    wetDarken: 0.08, exposedBleach: 0.025,
  }),
  forgedSteel: profile('forged-steel', 'metal', {
    macroScale: 45, mesoScale: 9, fineScale: 0.72,
    albedoMacro: 0.055, albedoMeso: 0.045, albedoFine: 0.018,
    roughnessBase: 0.48, roughnessMacro: 0.20, roughnessFine: 0.13,
    normalMacro: 0.025, normalFine: 0.04,
    oxidationAffinity: 0.14, streakStrength: 0.14, saltAffinity: 0.08,
    wetDarken: 0.055, exposedBleach: 0.018,
  }),
  snowPack: profile('snow-pack', 'cryosphere', {
    macroScale: 92, mesoScale: 18, fineScale: 2.0,
    albedoMacro: 0.065, albedoMeso: 0.055, albedoFine: 0.027,
    roughnessBase: 0.79, roughnessMacro: 0.13, roughnessFine: 0.085,
    normalMacro: 0.07, normalFine: 0.075,
    crustStrength: 0.16, windSastrugi: 0.21, impurityAffinity: 0.055,
    meltDarken: 0.08,
  }),
  glacierIce: profile('glacier-ice', 'cryosphere', {
    macroScale: 128, mesoScale: 24, fineScale: 2.8,
    albedoMacro: 0.07, albedoMeso: 0.06, albedoFine: 0.025,
    roughnessBase: 0.58, roughnessMacro: 0.17, roughnessFine: 0.10,
    normalMacro: 0.10, normalFine: 0.08,
    crustStrength: 0.11, windSastrugi: 0.13, impurityAffinity: 0.045,
    meltDarken: 0.13,
  }),
  generic: profile('generic-weathered', 'generic', {
    macroScale: 79, mesoScale: 16, fineScale: 2.2,
    albedoMacro: 0.075, albedoMeso: 0.055, albedoFine: 0.02,
    roughnessBase: 0.84, roughnessMacro: 0.10, roughnessFine: 0.06,
    normalMacro: 0.045, normalFine: 0.05,
    dampDarken: 0.10, exposedBleach: 0.04,
    oxidationAffinity: 0.02, mossAffinity: 0.02, lichenAffinity: 0.02,
  }),
});

const ORDERED_PROFILE_RULES = freeze([
  ['glacierIce', /glacier|blue[-_ ]?ice|ice[-_ ]?cave|crevasse/],
  ['snowPack', /snow|frost|sastrugi|winter[-_ ]?surface/],
  ['coniferNeedle', /needle|pine[-_ ]?leaf|spruce[-_ ]?leaf|fir[-_ ]?leaf|conifer[-_ ]?foliage/],
  ['treeBark', /bark|trunk|tree[-_ ]?wood/],
  ['deciduousLeaf', /leaf|foliage|canopy|deciduous/],
  ['grassBlade', /grass|reed|sedge|meadow[-_ ]?plant/],
  ['shrubLeaf', /shrub|bush|hedge|heath[-_ ]?plant|scrub/],
  ['weatheredPlank', /weathered[-_ ]?plank|board|dock|jetty/],
  ['structuralTimber', /wood|timber|beam|plank|log|door|oak/],
  ['oxidisedIron', /rust|oxid|iron|chain|anchor/],
  ['forgedSteel', /steel|blade|armou?r|metal/],
  ['thatch', /thatch|straw[-_ ]?roof/],
  ['roofTile', /roof[-_ ]?tile|shingle|slate[-_ ]?roof/],
  ['limePlaster', /plaster|stucco|lime|render/],
  ['firedBrick', /brick/],
  ['masonryStone', /masonry|castle|keep|tower|wall|foundation|ruin/],
  ['riverStone', /river[-_ ]?stone|river[-_ ]?rock|wet[-_ ]?stone|shore[-_ ]?stone/],
  ['talusStone', /talus|scree|boulder[-_ ]?field|rockfall|debris[-_ ]?rock/],
  ['basaltCliff', /basalt|volcanic[-_ ]?rock/],
  ['slateRidge', /slate|shale|schist|layered[-_ ]?rock/],
  ['graniteCliff', /granite|cliff|ridge|mountain[-_ ]?rock|rock|stone/],
  ['mud', /mud|bog[-_ ]?soil|wet[-_ ]?earth/],
  ['roadEarth', /road|path|track|trail/],
  ['exposedSoil', /soil|earth|dirt|sand|ground|field/],
]);

function signatureOf(context = {}) {
  const values = [
    context.paletteId,
    context.assetClass,
    context.subject?.id,
    context.subject?.name,
    context.subject?.category,
    context.subject?.src,
    context.mesh?.name,
    context.material?.name,
    context.material?.userData?.paletteId,
    context.material?.userData?.materialRole,
    context.material?.userData?.worldMaterialSurfaceFabric?.profileId,
  ];
  return values.filter(Boolean).join('|').toLowerCase();
}

export function inferWorldAssetSurfaceProfile(context = {}) {
  const explicitId = context.profileId
    ?? context.material?.userData?.worldAssetSurfaceProfileId
    ?? context.material?.userData?.worldMaterialSurfaceFabric?.assetProfileId;
  if (explicitId && WORLD_ASSET_SURFACE_PROFILES[explicitId]) return WORLD_ASSET_SURFACE_PROFILES[explicitId];
  const signature = signatureOf(context);
  for (const [id, pattern] of ORDERED_PROFILE_RULES) {
    if (pattern.test(signature)) return WORLD_ASSET_SURFACE_PROFILES[id];
  }
  return WORLD_ASSET_SURFACE_PROFILES.generic;
}

function ecologyValue(ecology, path, fallback = 0) {
  const segments = String(path).split('.');
  let value = ecology;
  for (const segment of segments) value = value?.[segment];
  return clamp01(finite(value, fallback));
}

function familyResponse(profileData, ecology = {}) {
  const moisture = ecologyValue(ecology, 'response.moisture', ecologyValue(ecology, 'moisture', 0.5));
  const aridity = ecologyValue(ecology, 'response.aridity', ecologyValue(ecology, 'aridity', 0.4));
  const exposure = ecologyValue(ecology, 'response.exposure', ecologyValue(ecology, 'exposure', 0.5));
  const shelter = ecologyValue(ecology, 'response.shelter', ecologyValue(ecology, 'shelter', 0.5));
  const erosion = ecologyValue(ecology, 'response.erosion', ecologyValue(ecology, 'erosion', 0.4));
  const deposition = ecologyValue(ecology, 'response.deposition', ecologyValue(ecology, 'deposition', 0.4));
  const frost = ecologyValue(ecology, 'response.frost', ecologyValue(ecology, 'frost', 0));
  const coastal = ecologyValue(ecology, 'domains.coastal', ecologyValue(ecology, 'coastal', 0));
  const woodland = ecologyValue(ecology, 'domains.woodland', ecologyValue(ecology, 'woodland', 0));
  const wetMeadow = ecologyValue(ecology, 'domains.wetMeadow', ecologyValue(ecology, 'wetMeadow', 0));
  const dryHeath = ecologyValue(ecology, 'domains.dryHeath', ecologyValue(ecology, 'dryHeath', 0));
  const bareRock = ecologyValue(ecology, 'domains.bareRock', ecologyValue(ecology, 'bareRock', 0));
  const lichen = ecologyValue(ecology, 'material.lichen', ecologyValue(ecology, 'lichen', 0));
  const moss = ecologyValue(ecology, 'material.moss', ecologyValue(ecology, 'moss', 0));
  const weathering = ecologyValue(ecology, 'material.weathering', ecologyValue(ecology, 'weathering', 0.45));

  const dampness = clamp01(moisture * 0.62 + wetMeadow * 0.13 + shelter * 0.10 + coastal * 0.07);
  const dryness = clamp01(aridity * 0.66 + dryHeath * 0.17 + exposure * 0.12);
  const oxidation = clamp01(
    (profileData.oxidationAffinity ?? 0) * (0.33 + dampness * 0.34 + exposure * 0.22 + coastal * 0.18),
  );
  const salt = clamp01(
    (profileData.saltAffinity ?? profileData.saltBloom ?? 0) * (coastal * 0.72 + exposure * 0.16 + dampness * 0.12),
  );
  const mossResponse = clamp01(
    (profileData.mossAffinity ?? 0) * (moss * 0.55 + dampness * 0.25 + woodland * 0.16 + shelter * 0.12),
  );
  const lichenResponse = clamp01(
    (profileData.lichenAffinity ?? 0) * (lichen * 0.52 + bareRock * 0.19 + exposure * 0.16 + frost * 0.10),
  );
  const bleaching = clamp01(
    (profileData.exposedBleach ?? profileData.dryBleach ?? profileData.sunBleach ?? 0)
      * (dryness * 0.48 + exposure * 0.34 + frost * 0.16),
  );
  const roughnessDelta = Math.max(-0.16, Math.min(0.16,
    dryness * 0.045
      + frost * 0.025
      + erosion * 0.020
      + deposition * 0.008
      - dampness * 0.055
      + oxidation * 0.035
      + salt * 0.025,
  ));
  return freeze({
    moisture,
    aridity,
    exposure,
    shelter,
    erosion,
    deposition,
    frost,
    coastal,
    woodland,
    wetMeadow,
    dryHeath,
    bareRock,
    dampness,
    dryness,
    oxidation,
    salt,
    moss: mossResponse,
    lichen: lichenResponse,
    bleaching,
    weathering,
    roughnessDelta,
  });
}

export function deriveWorldAssetSurfaceResponse(profileData, ecology = {}) {
  const selected = profileData?.id ? profileData : WORLD_ASSET_SURFACE_PROFILES.generic;
  const environment = familyResponse(selected, ecology);
  const macroSignal = ecologyValue(ecology, 'material.albedoMacro', 0.5);
  const mesoSignal = ecologyValue(ecology, 'material.albedoMeso', 0.5);
  const fineSignal = ecologyValue(ecology, 'material.albedoFine', 0.5);
  const roughMacro = ecologyValue(ecology, 'material.roughnessMacro', 0.5);
  const roughFine = ecologyValue(ecology, 'material.roughnessFine', 0.5);
  const normalMacro = ecologyValue(ecology, 'material.normalMacro', 0.5);
  const normalFine = ecologyValue(ecology, 'material.normalFine', 0.5);
  const albedoScalar = 1
    + (macroSignal - 0.5) * finite(selected.albedoMacro, 0.07)
    + (mesoSignal - 0.5) * finite(selected.albedoMeso, 0.05)
    + (fineSignal - 0.5) * finite(selected.albedoFine, 0.02)
    - environment.dampness * finite(selected.dampDarken ?? selected.wetDarken ?? selected.wetLeafDarken, 0.08)
    + environment.bleaching;
  const roughness = clamp01(
    finite(selected.roughnessBase, 0.84)
      + (roughMacro - 0.5) * finite(selected.roughnessMacro, 0.1)
      + (roughFine - 0.5) * finite(selected.roughnessFine, 0.06)
      + environment.roughnessDelta,
  );
  const normalStrength = clamp01(
    finite(selected.normalMacro, 0.05) * (0.65 + normalMacro * 0.70)
      + finite(selected.normalFine, 0.05) * (0.65 + normalFine * 0.70),
  );
  return freeze({
    revision: WORLD_ASSET_SURFACE_PROFILES_REVISION,
    profileId: selected.id,
    family: selected.family,
    scales: freeze({
      macroMeters: selected.macroScale,
      mesoMeters: selected.mesoScale,
      fineMeters: selected.fineScale,
    }),
    albedoScalar: Math.max(0.72, Math.min(1.22, albedoScalar)),
    roughness,
    normalStrength,
    environment,
    fabric: freeze({
      strataStrength: finite(selected.strataStrength, 0),
      strataFrequency: finite(selected.strataFrequency, 0),
      strataVerticalBias: finite(selected.strataVerticalBias, 0),
      fractureStrength: finite(selected.fractureStrength, 0),
      fractureScale: finite(selected.fractureScale, 0),
      grainStrength: finite(selected.grainStrength, 0),
      grainFrequency: finite(selected.grainFrequency, 0),
      ringStrength: finite(selected.ringStrength, 0),
      crackStrength: finite(selected.crackStrength, 0),
      sedimentStrength: finite(selected.sedimentStrength, 0),
      sedimentFrequency: finite(selected.sedimentFrequency, 0),
      pebbleStrength: finite(selected.pebbleStrength, 0),
      canopyMottle: finite(selected.canopyMottle, 0),
      chlorophyllVariation: finite(selected.chlorophyllVariation, 0),
      dripStrength: finite(selected.dripStrength, 0),
      foundationDamp: finite(selected.foundationDamp, 0),
      fiberStrength: finite(selected.fiberStrength, 0),
      fiberFrequency: finite(selected.fiberFrequency, 0),
      streakStrength: finite(selected.streakStrength, 0),
      crustStrength: finite(selected.crustStrength, 0),
      windSastrugi: finite(selected.windSastrugi, 0),
    }),
  });
}

export function worldAssetSurfaceProfileSummary(context = {}, ecology = {}) {
  const selected = inferWorldAssetSurfaceProfile(context);
  const response = deriveWorldAssetSurfaceResponse(selected, ecology);
  return freeze({
    policyId: WORLD_ASSET_SURFACE_PROFILES_POLICY.id,
    revision: WORLD_ASSET_SURFACE_PROFILES_REVISION,
    profileId: selected.id,
    family: selected.family,
    albedoScalar: response.albedoScalar,
    roughness: response.roughness,
    normalStrength: response.normalStrength,
    dampness: response.environment.dampness,
    oxidation: response.environment.oxidation,
    salt: response.environment.salt,
    moss: response.environment.moss,
    lichen: response.environment.lichen,
  });
}
