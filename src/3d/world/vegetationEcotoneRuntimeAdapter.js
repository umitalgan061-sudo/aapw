const clamp01 = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
};

const finite = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const hash2 = (x, z, seed = 0) => {
  const s = Math.sin((x * 127.1) + (z * 311.7) + (seed * 74.3)) * 43758.5453;
  return s - Math.floor(s);
};

const normalizeBiome = (value) => String(value || 'temperate').trim().toLowerCase();

const BIOME_BIAS = Object.freeze({
  alpine: { forest: 0.22, shrub: 0.55, grass: 0.38, ground: 0.22 },
  boreal: { forest: 0.82, shrub: 0.55, grass: 0.36, ground: 0.28 },
  temperate: { forest: 0.64, shrub: 0.62, grass: 0.72, ground: 0.42 },
  marsh: { forest: 0.18, shrub: 0.74, grass: 0.84, ground: 0.58 },
  arid: { forest: 0.08, shrub: 0.48, grass: 0.18, ground: 0.36 },
});

const biasFor = (biome) => BIOME_BIAS[biome] || BIOME_BIAS.temperate;

const freeze = (value) => Object.freeze(value);

export function createVegetationEcotoneRuntimeAdapter(input = {}) {
  const biome = normalizeBiome(input.biome);
  const bias = biasFor(biome);
  const x = finite(input.x);
  const z = finite(input.z);
  const seed = finite(input.seed);
  const height = clamp01(input.height01, 0.5);
  const slope = clamp01(input.slope01);
  const moisture = clamp01(input.moisture01, 0.5);
  const waterDistance = Math.max(0, finite(input.waterDistance, 100));
  const roadDistance = Math.max(0, finite(input.roadDistance, 100));
  const settlementDistance = Math.max(0, finite(input.settlementDistance, 100));
  const snow = clamp01(input.snow01);
  const canopy = clamp01(input.canopy01);
  const clearance = clamp01(input.clearance01, 0.5);
  const loadedAssetCount = Math.max(0, Math.floor(finite(input.loadedAssetCount)));
  const rendererBudget = clamp01(input.rendererBudget01, 1);

  const localVariation = (hash2(x * 0.017, z * 0.017, seed) - 0.5) * 0.18;
  const edgeVariation = (hash2(x * 0.071, z * 0.071, seed + 17) - 0.5) * 0.12;
  const slopePenalty = smoothstep(0.42, 0.88, slope);
  const alpinePenalty = smoothstep(0.55, 0.92, snow);
  const waterPenalty = smoothstep(0, 18, waterDistance);
  const roadPenalty = smoothstep(0, 8, roadDistance);
  const settlementPenalty = smoothstep(0, 20, settlementDistance);
  const edgeBand = smoothstep(0.18, 0.52, waterDistance / 80);

  const forest = clamp01((bias.forest + localVariation) * (1 - slopePenalty * 0.82) * (1 - alpinePenalty * 0.9) * waterPenalty * roadPenalty * settlementPenalty * (0.72 + canopy * 0.4));
  const shrub = clamp01((bias.shrub + edgeVariation) * (0.55 + moisture * 0.65) * (1 - alpinePenalty * 0.35) * (1 - slopePenalty * 0.2) * (0.65 + clearance * 0.35));
  const grass = clamp01((bias.grass + localVariation * 0.7) * (0.48 + moisture * 0.72) * (1 - alpinePenalty * 0.62) * (0.72 + clearance * 0.3));
  const groundDetail = clamp01((bias.ground + edgeVariation * 0.5) * (0.7 + clearance * 0.35) * (1 - slopePenalty * 0.28));
  const ecotone = clamp01(Math.abs(forest - grass) * 0.72 + edgeBand * 0.38 + Math.abs(shrub - grass) * 0.24);

  const density = clamp01((forest * 0.46 + shrub * 0.24 + grass * 0.22 + groundDetail * 0.08) * rendererBudget);
  const clusterScale = 0.78 + clamp01(canopy * 0.8 + moisture * 0.32) * 0.68;
  const naturalYaw = (hash2(x, z, seed + 3) * 2 - 1) * Math.PI;
  const scaleJitter = 0.88 + hash2(x * 0.11, z * 0.11, seed + 7) * 0.28;
  const lodTier = density > 0.68 ? 'hero' : density > 0.34 ? 'mid' : 'impostor';
  const instancingRequired = density > 0.24 || loadedAssetCount > 48;

  const invalidPlacement = Boolean(
    waterDistance < 2 ||
    roadDistance < 1.2 ||
    settlementDistance < 3 ||
    slope > 0.92 ||
    snow > 0.97 ||
    loadedAssetCount > 512 ||
    rendererBudget < 0.08
  );

  const placement = freeze({
    accepted: !invalidPlacement,
    reason: invalidPlacement
      ? (waterDistance < 2 ? 'water-proximity' : slope > 0.92 ? 'steep-slope' : snow > 0.97 ? 'snow-cover' : 'budget-or-clearance')
      : 'grounded-ecotone',
    clusterScale: Number(clusterScale.toFixed(4)),
    naturalYaw: Number(naturalYaw.toFixed(4)),
    scaleJitter: Number(scaleJitter.toFixed(4)),
    lodTier,
    instancingRequired,
  });

  return freeze({
    schema: 'vegetation-ecotone-runtime-adapter/v19',
    biome,
    masks: freeze({
      forest: Number(forest.toFixed(4)),
      shrub: Number(shrub.toFixed(4)),
      grass: Number(grass.toFixed(4)),
      groundDetail: Number(groundDetail.toFixed(4)),
      ecotone: Number(ecotone.toFixed(4)),
    }),
    density: Number(density.toFixed(4)),
    macroVariation: Number(Math.abs(localVariation).toFixed(4)),
    microVariation: Number(Math.abs(edgeVariation).toFixed(4)),
    antiTilingPhase: Number(((hash2(x * 0.031, z * 0.031, seed + 19) * Math.PI * 2) % (Math.PI * 2)).toFixed(4)),
    renderer: freeze({
      lodTier,
      instancingRequired,
      budget01: rendererBudget,
      loadedAssetCount,
    }),
    placement,
    authority: freeze({
      canonicalTerrain: 'caller-owned',
      canonicalHydrology: 'caller-owned',
      collider: 'caller-owned',
      materialPlacement: 'MaterialAssignmentCore+WorldAssetPlacementPipeline',
      editorUi: 'forbidden',
    }),
  });
}

export function applyVegetationEcotoneRuntimeAdapter(adapter, target = {}) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('adapter is required');
  const next = target && typeof target === 'object' ? target : {};
  next.vegetationEcotone = {
    density: adapter.density,
    forest: adapter.masks.forest,
    shrub: adapter.masks.shrub,
    grass: adapter.masks.grass,
    groundDetail: adapter.masks.groundDetail,
    ecotone: adapter.masks.ecotone,
    lodTier: adapter.renderer.lodTier,
    instancingRequired: adapter.renderer.instancingRequired,
    antiTilingPhase: adapter.antiTilingPhase,
  };
  return next;
}

export const serializeVegetationEcotoneRuntimeAdapter = (value) => JSON.stringify(value);
