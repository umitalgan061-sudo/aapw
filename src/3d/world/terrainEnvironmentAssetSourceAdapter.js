import { TERRAIN_ENVIRONMENT_ASSET_MANIFEST } from './terrainEnvironmentAssetManifest.js';
import { findVerifiedEnvironmentAsset, validateVerifiedEnvironmentAsset } from './terrainEnvironmentAssetRegistry.js';
import { resolveTerrainEnvironmentProfile } from './terrainEnvironmentProfiles.js';
import { scoreEnvironmentAssetGeography } from './terrainEnvironmentAssetGeographyMatrix.js';

const freeze = (value) => Object.freeze(value);
const norm = (value) => String(value ?? '').trim().toLowerCase();
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const TERRAIN_ENVIRONMENT_ASSET_SOURCE_POLICY = freeze({
  id: 'terrain-environment-asset-source-adapter-2026-09-08-v2',
  manifestAuthority: 'src/3d/world/terrainEnvironmentAssetManifest.js',
  registryAuthority: 'src/3d/world/terrainEnvironmentAssetRegistry.js',
  geographyAuthority: 'src/3d/world/terrainEnvironmentAssetGeographyMatrix.js',
  authoredOnly: true,
  placeholderAllowed: false,
  proceduralReplacementAllowed: false,
  unknownSourceAllowed: false,
  geologyCategories: freeze(['rock', 'cliff', 'scree']),
});

function familyAllowed(profile, family, entry) {
  if (!profile) return false;
  const value = norm(family);
  if (profile.category === 'tree') return ['tree', 'dead-tree', 'snow-dead-tree', 'winter-tree', 'twisted-tree'].includes(value);
  if (profile.category === 'shrub') return ['fern', 'flower', 'flower-grass'].includes(value);
  if (profile.category === 'grass') return ['grass', 'grass-ground-cover', 'flower-grass', 'flower', 'crop', 'ground-prop'].includes(value);
  if (profile.category === 'snow-patch') return ['snow-dead-tree', 'winter-tree', 'snow'].includes(value);
  if (profile.category === 'rock') return Boolean(entry.geology) || ['rock', 'cliff', 'scree'].includes(value);
  if (profile.category === 'cliff') return Boolean(entry.geology) || ['rock', 'cliff'].includes(value);
  if (profile.category === 'scree') return Boolean(entry.geology) || ['rock', 'scree'].includes(value);
  return false;
}

function candidateMatchesSeason(entry, { season = '', winter = false } = {}) {
  const sourceSeason = norm(entry.season);
  const key = norm(season);
  if (key && sourceSeason && sourceSeason === key) return true;
  if (!winter && key !== 'winter') return true;
  if (key === 'winter' || winter) {
    if (entry.winter === true) return true;
    if (sourceSeason && /(winter|snow|ice|evergreen|temperate-winter)/.test(sourceSeason)) return true;
    if (entry.geology === true) return norm(entry.id).includes('rock');
    return false;
  }
  return true;
}

function candidateMatchesBiome(entry, biome) {
  const b = norm(biome);
  if (!b) return true;
  const explicit = entry.biomes ?? entry.climates ?? [];
  if (!explicit.length) return true;
  return explicit.some((value) => norm(value) === b);
}

export function sourceCandidates(category, { biome = '', season = '', winter = false, assetManifest = TERRAIN_ENVIRONMENT_ASSET_MANIFEST } = {}) {
  const profile = resolveTerrainEnvironmentProfile(category);
  if (!profile) return freeze([]);
  const candidates = assetManifest.filter((entry) => familyAllowed(profile, entry.family, entry))
    .filter((entry) => candidateMatchesBiome(entry, biome))
    .filter((entry) => candidateMatchesSeason(entry, { season, winter }));
  const registryMatches = candidates.length
    ? candidates
    : (norm(category) === 'rock' || norm(category) === 'cliff' || norm(category) === 'scree')
      ? assetManifest.filter((entry) => entry.geology === true)
      : [];
  return freeze(registryMatches);
}

export function sourceCandidateScore(entry, { category = '', biome = '', season = '', winter = false, preferred = true, sample = {} } = {}) {
  if (!entry) return 0;
  const profile = resolveTerrainEnvironmentProfile(category, entry);
  if (!profile || !familyAllowed(profile, entry.family, entry)) return 0;
  if (!candidateMatchesBiome(entry, biome)) return 0.18;
  let score = 0.24;
  if (entry.preferred) score += preferred ? 0.18 : 0.08;
  if (biome && candidateMatchesBiome(entry, biome)) score += 0.26;
  if (winter && candidateMatchesSeason(entry, { winter })) score += 0.16;
  if (season && candidateMatchesSeason(entry, { season, winter })) score += 0.10;
  if (entry.geology && ['rock', 'cliff', 'scree'].includes(norm(category))) score += 0.12;
  if (sample) {
    const geography = scoreEnvironmentAssetGeography(entry, sample);
    score += geography.score * 0.34;
  }
  return Math.max(0, Math.min(1, score));
}

export function selectSourceAsset(category, options = {}) {
  const candidates = sourceCandidates(category, options);
  const ranked = candidates.map((entry, index) => ({ entry, score: sourceCandidateScore(entry, { category, ...options }), index }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.length ? freeze(ranked[0]) : null;
}

export function resolveRuntimeEnvironmentSource(category, options = {}) {
  const selected = selectSourceAsset(category, options);
  if (!selected) return null;
  const source = findVerifiedEnvironmentAsset(selected.entry.src);
  if (!source) return freeze({ ok: false, error: 'asset-not-verified', candidate: selected });
  const validation = validateVerifiedEnvironmentAsset(source, { category, sample: options.sample ?? {} });
  return freeze({ ok: validation.ok, source, registryValidation: validation, score: selected.score, policyId: TERRAIN_ENVIRONMENT_ASSET_SOURCE_POLICY.id });
}

export function buildRuntimeSourceManifest(requests = []) {
  const entries = requests.map((request) => {
    const resolved = resolveRuntimeEnvironmentSource(request.category, request);
    return freeze({
      request: freeze({ ...request }),
      resolved,
      acceptance: freeze({ ok: Boolean(resolved?.ok && resolved?.source?.src), placeholderAllowed: false, proceduralReplacementAllowed: false }),
    });
  });
  const errors = entries.flatMap((entry) => entry.acceptance.ok ? [] : [`source-rejected:${entry.request.category}`]);
  return freeze({ version: 2, policyId: TERRAIN_ENVIRONMENT_ASSET_SOURCE_POLICY.id, entries, errors: freeze(errors), acceptance: freeze({ ok: errors.length === 0, errorCount: errors.length }) });
}

export function sourceManifestByBiome(biome) {
  const b = norm(biome);
  return freeze(TERRAIN_ENVIRONMENT_ASSET_MANIFEST.filter((entry) => (entry.biomes ?? entry.climates ?? []).some((value) => norm(value) === b)));
}

export function sourceManifestBySeason(season) {
  const s = norm(season);
  if (s === 'winter') return freeze(TERRAIN_ENVIRONMENT_ASSET_MANIFEST.filter((entry) => entry.winter === true || norm(entry.season) === s));
  return freeze(TERRAIN_ENVIRONMENT_ASSET_MANIFEST.filter((entry) => norm(entry.season) === s));
}

export function sourceCoverageSummary(categories = ['tree', 'shrub', 'grass', 'rock', 'cliff', 'scree', 'snow-patch']) {
  const rows = categories.map((category) => {
    const candidates = sourceCandidates(category, {});
    return freeze({ category, candidateCount: candidates.length, preferredCount: candidates.filter((entry) => entry.preferred).length, authoredCount: candidates.filter((entry) => Boolean(entry.src)).length, geologyCount: candidates.filter((entry) => entry.geology === true).length });
  });
  return freeze({ policyId: TERRAIN_ENVIRONMENT_ASSET_SOURCE_POLICY.id, rows, missing: freeze(rows.filter((row) => row.authoredCount === 0).map((row) => row.category)), geologyMissing: freeze(rows.filter((row) => ['rock', 'cliff', 'scree'].includes(row.category) && row.geologyCount === 0).map((row) => row.category)), ok: rows.every((row) => row.authoredCount > 0) });
}

export function sourceDeterministicOrdinal(category, worldX = 0, worldZ = 0, ordinal = 0) {
  const text = `${norm(category)}:${finite(worldX).toFixed(2)}:${finite(worldZ).toFixed(2)}:${Number(ordinal) | 0}`;
  let hash = 2166136261;
  for (const character of text) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

export function validateSourceRequest(request = {}) {
  const errors = [];
  if (!request.category) errors.push('missing-category');
  if (!resolveTerrainEnvironmentProfile(request.category)) errors.push('missing-profile');
  const source = request.src ? findVerifiedEnvironmentAsset(request.src) : resolveRuntimeEnvironmentSource(request.category, request)?.source;
  if (!source) errors.push('missing-authored-source');
  if (request.placeholder === true) errors.push('placeholder-source');
  if (['rock','cliff','scree'].includes(norm(request.category)) && !source?.geology) errors.push('geology-source-required');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), source: source ?? null, policyId: TERRAIN_ENVIRONMENT_ASSET_SOURCE_POLICY.id });
}
