/**
 * Geography-aware catalog for authored scenery sources already present in the repository.
 * This is metadata only: vegetation.js remains the scatter owner and the shared placement pipeline
 * remains the placement authority. A missing authored source is reported explicitly so procedural
 * fallback never gets mistaken for a materialized biome asset.
 */

const ASSETS = Object.freeze({
  snow: Object.freeze([
    'assets/models/vegetation/pine_Zt62gceKXZ.glb',
    'assets/models/vegetation/winter_tree.glb',
    'assets/models/vegetation/dead_trees_with_snow_iEuwXWner0.glb',
    'assets/models/vegetation/birch_trees_R7qMWzb7nk.glb',
  ]),
  north: Object.freeze([
    'assets/models/vegetation/pine_Zt62gceKXZ.glb',
    'assets/models/vegetation/birch_trees_R7qMWzb7nk.glb',
    'assets/models/vegetation/big_tree_by_3donimus_dnwh762pn_6_1_na.glb',
    'assets/models/vegetation/dead_tree_n8FhMgMldD.glb',
  ]),
  marsh: Object.freeze([
    'assets/models/vegetation/dead_tree_n8FhMgMldD.glb',
    'assets/models/vegetation/dead_trees_F5I0Q7TwO5.glb',
  ]),
  mountain: Object.freeze([
    'assets/models/vegetation/pine_Zt62gceKXZ.glb',
    'assets/models/vegetation/birch_trees_R7qMWzb7nk.glb',
    'assets/models/vegetation/dead_tree_n8FhMgMldD.glb',
  ]),
  westerlands: Object.freeze([
    'assets/models/vegetation/big_tree_by_3donimus_dnwh762pn_6_1_na.glb',
    'assets/models/vegetation/birch_trees_R7qMWzb7nk.glb',
    'assets/models/vegetation/fall_tree_4GYen9Xm3Kj.glb',
  ]),
  reach: Object.freeze([
    'assets/models/vegetation/big_tree_by_3donimus_dnwh762pn_6_1_na.glb',
    'assets/models/vegetation/crops_Ro6K0Yg7mx.glb',
    'assets/models/vegetation/flower_brown_tall.glb',
  ]),
  desert: Object.freeze([
    'assets/models/vegetation/dead_tree_n8FhMgMldD.glb',
    'assets/models/vegetation/dead_trees_F5I0Q7TwO5.glb',
  ]),
  steppe: Object.freeze([
    'assets/models/vegetation/big_tree_by_3donimus_dnwh762pn_6_1_na.glb',
    'assets/models/vegetation/dead_tree_n8FhMgMldD.glb',
    'assets/models/vegetation/flower_brown_tall.glb',
  ]),
  arid: Object.freeze([
    'assets/models/vegetation/dead_tree_n8FhMgMldD.glb',
    'assets/models/vegetation/dead_trees_F5I0Q7TwO5.glb',
  ]),
  coast: Object.freeze([
    'assets/models/vegetation/big_tree_by_3donimus_dnwh762pn_6_1_na.glb',
    'assets/models/vegetation/dead_tree_n8FhMgMldD.glb',
  ]),
  jungle: Object.freeze([
    'assets/models/vegetation/big_tree_by_3donimus_dnwh762pn_6_1_na.glb',
    'assets/models/vegetation/birch_trees_R7qMWzb7nk.glb',
  ]),
  valyria: Object.freeze([
    'assets/models/vegetation/dead_tree_n8FhMgMldD.glb',
    'assets/models/vegetation/dead_trees_F5I0Q7TwO5.glb',
  ]),
  temperate: Object.freeze([
    'assets/models/vegetation/big_tree_by_3donimus_dnwh762pn_6_1_na.glb',
    'assets/models/vegetation/birch_trees_R7qMWzb7nk.glb',
    'assets/models/vegetation/fall_tree_4GYen9Xm3Kj.glb',
    'assets/models/vegetation/crops_Ro6K0Yg7mx.glb',
  ]),
});

const FAMILY_TAGS = Object.freeze({
  'pine_Zt62gceKXZ': Object.freeze(['evergreen', 'conifer', 'cold']),
  winter_tree: Object.freeze(['winter', 'snow', 'cold']),
  dead_trees_with_snow_iEuwXWner0: Object.freeze(['dead', 'snow', 'cold']),
  birch_trees_R7qMWzb7nk: Object.freeze(['birch', 'mixed-forest', 'boreal']),
  big_tree_by_3donimus_dnwh762pn_6_1_na: Object.freeze(['broad-canopy', 'temperate', 'field']),
  dead_tree_n8FhMgMldD: Object.freeze(['dead', 'dry', 'disturbed']),
  dead_trees_F5I0Q7TwO5: Object.freeze(['dead-grove', 'dry', 'disturbed']),
  fall_tree_4GYen9Xm3Kj: Object.freeze(['deciduous', 'temperate', 'seasonal']),
  crops_Ro6K0Yg7mx: Object.freeze(['crop', 'farm', 'open-field']),
  flower_brown_tall: Object.freeze(['flower', 'meadow', 'understory']),
});

export const LIVING_WORLD_SCENERY_ASSET_POLICY = Object.freeze({
  id: 'living-world-scenery-authored-catalog-2026-09-07-v1',
  deterministic: true,
  geographyAuthority: 'livingWorldGeographyAdapter.js',
  scatterAuthority: 'vegetation.js',
  placementAuthority: 'WorldAssetPlacementPipeline.js',
  authoredOnly: true,
  proceduralFallbackExplicit: true,
});

function normalize(region) { return String(region ?? '').trim().toLowerCase(); }
function basename(path) { return String(path ?? '').split('/').pop()?.replace(/\.glb$/i, '') || ''; }

export function authoredSceneryAssetsForRegion(region) {
  const key = normalize(region);
  return Object.freeze([...(ASSETS[key] || [])]);
}

export function authoredSceneryFamiliesForRegion(region) {
  return Object.freeze(authoredSceneryAssetsForRegion(region).map((path) => Object.freeze({ path, family: basename(path), tags: FAMILY_TAGS[basename(path)] || ['authored'] })));
}

export function resolveSceneryAssetCandidates({ region = 'temperate', preferredTags = [], seed = 0 } = {}) {
  const candidates = authoredSceneryFamiliesForRegion(region);
  const tags = new Set((preferredTags || []).map(normalize).filter(Boolean));
  const score = (entry) => {
    const overlap = entry.tags.filter((tag) => tags.has(normalize(tag))).length;
    let hash = 2166136261 ^ seed;
    for (const char of entry.path) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619) >>> 0; }
    return overlap * 10 + ((hash >>> 0) / 0x100000000);
  };
  return Object.freeze(candidates.map((entry) => ({ ...entry, score: Number(score(entry).toFixed(6)) })).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)));
}

export function auditSceneryAssetCoverage(regions = Object.keys(ASSETS)) {
  const unique = new Set();
  const byRegion = {};
  const errors = [];
  for (const region of regions) {
    const key = normalize(region);
    const assets = authoredSceneryAssetsForRegion(key);
    byRegion[key] = assets.length;
    if (!assets.length) errors.push(`${key}:no-authored-scenery`);
    for (const path of assets) {
      unique.add(path);
      if (!/^assets\/models\/vegetation\/.*\.glb$/i.test(path)) errors.push(`${key}:invalid-path:${path}`);
    }
  }
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    regionCount: Object.keys(byRegion).length,
    authoredAssetCount: unique.size,
    byRegion: Object.freeze({ ...byRegion }),
  });
}

export function sceneryAssetCoverageDigest(regions = Object.keys(ASSETS)) {
  const audit = auditSceneryAssetCoverage(regions);
  const source = JSON.stringify({ policyId: LIVING_WORLD_SCENERY_ASSET_POLICY.id, byRegion: audit.byRegion, authoredAssetCount: audit.authoredAssetCount });
  let hash = 2166136261;
  for (const char of source) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619) >>> 0; }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function summarizeSceneryAssetContext({ region = 'temperate', moisture = 0, slopeDegrees = 0 } = {}) {
  const wet = Number(moisture) > 0.7;
  const steep = Number(slopeDegrees) >= 24;
  const preferredTags = [wet ? 'understory' : null, steep ? 'conifer' : null, !wet && !steep ? 'field' : null].filter(Boolean);
  const candidates = resolveSceneryAssetCandidates({ region, preferredTags });
  return Object.freeze({
    region: normalize(region) || 'temperate',
    preferredTags: Object.freeze(preferredTags),
    candidates,
    authored: candidates.length > 0,
    fallback: candidates.length === 0 ? 'procedural-vegetation' : null,
  });
}
