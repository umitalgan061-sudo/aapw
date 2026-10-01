const freeze = (value) => Object.freeze(value);
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const TERRAIN_ENVIRONMENT_CLUSTER_POLICY = freeze({
  id: 'terrain-environment-cluster-planner-2026-09-07-v1',
  deterministic: true,
  worldSpace: true,
  noGeometryInstantiation: true,
  noCanonicalMutation: true,
  minimumSeparationMeters: freeze({ tree: 8, shrub: 3, grass: 0.7, rock: 12, snowPatch: 18, house: 45, bridge: 55 }),
  jitterMeters: freeze({ tree: 14, shrub: 7, grass: 2, rock: 18, snowPatch: 24, house: 9, bridge: 6 }),
  densityCaps: freeze({ tree: 320, shrub: 520, grass: 1400, rock: 130, snowPatch: 70, house: 28, bridge: 14 }),
});

function hashString(text) {
  let hash = 2166136261;
  for (const char of String(text)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashUnit(...parts) {
  return hashString(parts.join('|')) / 4294967296;
}

function normalizedCategory(category) {
  return String(category || '').trim().toLowerCase();
}

function isWaterUnsafe(category, context) {
  const depth = Math.max(0, finite(context.waterDepthMeters, 0));
  return depth > 0.05 && category !== 'bridge';
}

export function resolveEnvironmentDensity(category, context = {}) {
  const c = normalizedCategory(category);
  if (!c || isWaterUnsafe(c, context)) return 0;
  const biome = normalizedCategory(context.biome);
  const moisture = clamp01(context.moisture);
  const slope = clamp01(finite(context.slopeDegrees, 0) / 65);
  const rock = clamp01(context.rockWeight);
  const snow = clamp01(context.snowWeight);
  const elevation = finite(context.elevationMeters, 0);
  const temperature = finite(context.temperatureC, 12);
  const wind = clamp01(context.windExposure);
  const forest = biome.includes('forest') || biome.includes('wood') ? 0.82 : 0.18;
  const meadow = biome.includes('meadow') || biome.includes('grass') ? 0.78 : 0.22;
  const alpine = biome.includes('alpine') || elevation > 1200 ? 0.8 : 0.15;
  const tundra = biome.includes('tundra') || temperature < 2 ? 0.82 : 0.08;
  if (c === 'tree') return clamp01(0.32 + forest * 0.55 + moisture * 0.12 - slope * 0.46 - rock * 0.2 - wind * 0.12);
  if (c === 'shrub') return clamp01(0.35 + forest * 0.22 + meadow * 0.15 + moisture * 0.25 - slope * 0.16);
  if (c === 'grass') return clamp01(0.42 + meadow * 0.34 + moisture * 0.16 - slope * 0.18 - rock * 0.12);
  if (c === 'rock') return clamp01(0.12 + rock * 0.62 + slope * 0.4 + alpine * 0.14);
  if (c === 'snowpatch') return clamp01(0.08 + snow * 0.72 + tundra * 0.18 + wind * 0.08);
  if (c === 'house') return clamp01(0.2 + (1 - slope) * 0.34 + (1 - moisture) * 0.18 - rock * 0.2);
  if (c === 'bridge') return clamp01(0.28 + (context.waterDepthMeters > 0 ? 0.42 : 0) + (1 - slope) * 0.18);
  return 0;
}

export function resolveEnvironmentSpacing(category, context = {}) {
  const c = normalizedCategory(category);
  const base = TERRAIN_ENVIRONMENT_CLUSTER_POLICY.minimumSeparationMeters[c] || 5;
  const distance = Math.max(0, finite(context.distanceMeters, 0));
  const density = Math.max(0.2, finite(context.density, 1));
  const visibility = Math.max(0.35, Math.min(1.15, finite(context.visibility, 1)));
  const distanceScale = distance < 80 ? 0.75 : distance < 350 ? 1 : distance < 1100 ? 1.35 : 1.8;
  return freeze({ baseMeters: base, separationMeters: base * distanceScale * visibility / Math.sqrt(density) });
}

export function makeEnvironmentCandidate({ category, worldX, worldZ, seed = 0, ordinal = 0, context = {} } = {}) {
  const c = normalizedCategory(category);
  const sourceX = finite(worldX);
  const sourceZ = finite(worldZ);
  const density = resolveEnvironmentDensity(c, context);
  const jitterRange = TERRAIN_ENVIRONMENT_CLUSTER_POLICY.jitterMeters[c] || 4;
  const rx = hashUnit(seed, c, ordinal, sourceX, sourceZ, 'x');
  const rz = hashUnit(seed, c, ordinal, sourceX, sourceZ, 'z');
  const rotation = hashUnit(seed, c, ordinal, 'rotation') * Math.PI * 2;
  const accepted = density > 0.08 && !isWaterUnsafe(c, context);
  const candidate = freeze({
    category: c,
    sourceWorld: freeze({ x: sourceX, z: sourceZ }),
    candidateWorld: freeze({ x: sourceX + (rx - 0.5) * jitterRange * 2, z: sourceZ + (rz - 0.5) * jitterRange * 2 }),
    rotationY: rotation,
    density,
    accepted,
    waterSafe: !isWaterUnsafe(c, context),
    groundRequired: c !== 'bridge',
    assetFirst: true,
    noPlaceholderGeometry: true,
    spacing: resolveEnvironmentSpacing(c, { ...context, density }),
    provenance: freeze({ source: 'canonical-terrain-context', seed: String(seed), ordinal }),
  });
  return candidate;
}

function separated(candidate, accepted) {
  for (const previous of accepted) {
    const dx = candidate.candidateWorld.x - previous.candidateWorld.x;
    const dz = candidate.candidateWorld.z - previous.candidateWorld.z;
    const minDistance = Math.max(candidate.spacing.separationMeters, previous.spacing.separationMeters);
    if (dx * dx + dz * dz < minDistance * minDistance) return false;
  }
  return true;
}

export function planEnvironmentCluster({ category, centerX = 0, centerZ = 0, radiusMeters = 100, count = 24, seed = 0, context = {} } = {}) {
  const c = normalizedCategory(category);
  const requested = Math.max(0, Math.floor(finite(count, 0)));
  const cap = TERRAIN_ENVIRONMENT_CLUSTER_POLICY.densityCaps[c] || requested;
  const total = Math.min(requested, cap);
  const radius = Math.max(0, finite(radiusMeters, 0));
  const goldenAngle = 2.399963229728653;
  const accepted = [];
  for (let index = 0; index < total; index += 1) {
    const radial = Math.sqrt((index + 0.5) / Math.max(1, total)) * radius;
    const angle = index * goldenAngle + hashUnit(seed, c, 'cluster-angle') * Math.PI * 2;
    const point = makeEnvironmentCandidate({
      category: c,
      worldX: finite(centerX) + Math.cos(angle) * radial,
      worldZ: finite(centerZ) + Math.sin(angle) * radial,
      seed,
      ordinal: index,
      context,
    });
    if (point.accepted && separated(point, accepted)) accepted.push(point);
  }
  return freeze({
    version: 1,
    policyId: TERRAIN_ENVIRONMENT_CLUSTER_POLICY.id,
    category: c,
    center: freeze({ x: finite(centerX), z: finite(centerZ) }),
    requested,
    planned: accepted.length,
    cap,
    points: freeze(accepted),
    acceptance: freeze({
      ok: true,
      deterministic: true,
      uniformGrid: false,
      spacingEnforced: true,
      waterSafe: accepted.every((point) => point.waterSafe),
    }),
  });
}

export function planEnvironmentRegions({ category, regions = [], seed = 0 } = {}) {
  const clusters = regions.map((region, index) => planEnvironmentCluster({
    category,
    centerX: region.centerX,
    centerZ: region.centerZ,
    radiusMeters: region.radiusMeters,
    count: region.count,
    seed: `${seed}:${index}`,
    context: region.context,
  }));
  return freeze({
    policyId: TERRAIN_ENVIRONMENT_CLUSTER_POLICY.id,
    category: normalizedCategory(category),
    clusters: freeze(clusters),
    summary: freeze({ regions: clusters.length, planned: clusters.reduce((sum, cluster) => sum + cluster.planned, 0) }),
  });
}

export function auditEnvironmentCluster(cluster) {
  const errors = [];
  const points = Array.isArray(cluster?.points) ? cluster.points : [];
  if (!cluster?.acceptance?.deterministic) errors.push('non-deterministic-policy');
  if (cluster?.acceptance?.uniformGrid) errors.push('uniform-grid');
  for (const point of points) {
    if (!point.accepted) errors.push('rejected-point');
    if (!Number.isFinite(point.candidateWorld.x) || !Number.isFinite(point.candidateWorld.z)) errors.push('non-finite-world-position');
    if (!point.waterSafe) errors.push('unsafe-water-placement');
    if (!point.assetFirst || point.noPlaceholderGeometry !== true) errors.push('asset-policy-violation');
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors), count: points.length });
}
