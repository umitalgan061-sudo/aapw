/**
 * Canonical transition profile catalogue for Settlement World Coverage.
 *
 * This catalogue is intentionally declarative. It describes presentation and
 * safety hints for the cross-scale transition layer, but owns no world state.
 * The profile matrix is generated from finite vocabularies so every combination
 * remains deterministic and easy to audit without storing thousands of copies.
 */
export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CONTEXTS = Object.freeze([
  'north-cold', 'north-temperate', 'north-river', 'north-moor', 'mountain-cold',
  'mountain-pass', 'river-lowland', 'forest-edge', 'woodland', 'shoreline',
]);
export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SERVICES = Object.freeze([
  'gate', 'market', 'tavern', 'blacksmith', 'farm', 'barracks', 'stable', 'house',
]);
export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_STAGES = Object.freeze([
  'far', 'approach', 'threshold', 'inside', 'service', 'departure', 'resume',
]);

const PROFILE_BY_SERVICE = Object.freeze({
  gate: Object.freeze({ focus: 'route', density: 0.52, audio: 'road', icon: 'gate' }),
  market: Object.freeze({ focus: 'trade', density: 0.74, audio: 'crowd', icon: 'market' }),
  tavern: Object.freeze({ focus: 'rest', density: 0.58, audio: 'interior', icon: 'tavern' }),
  blacksmith: Object.freeze({ focus: 'craft', density: 0.68, audio: 'forge', icon: 'blacksmith' }),
  farm: Object.freeze({ focus: 'survival', density: 0.48, audio: 'field', icon: 'farm' }),
  barracks: Object.freeze({ focus: 'train', density: 0.61, audio: 'training', icon: 'barracks' }),
  stable: Object.freeze({ focus: 'travel', density: 0.55, audio: 'stable', icon: 'stable' }),
  house: Object.freeze({ focus: 'save', density: 0.44, audio: 'home', icon: 'house' }),
});

const STAGE_MULTIPLIER = Object.freeze({
  far: 0.35, approach: 0.62, threshold: 0.84, inside: 1,
  service: 1, departure: 0.72, resume: 0.9,
});
const CONTEXT_MULTIPLIER = Object.freeze({
  'north-cold': 0.82, 'north-temperate': 1, 'north-river': 1.08, 'north-moor': 0.9,
  'mountain-cold': 0.76, 'mountain-pass': 0.88, 'river-lowland': 1.06,
  'forest-edge': 0.94, woodland: 0.97, shoreline: 0.86,
});
const CONTEXT_TAGS = Object.freeze({
  'north-cold': ['snow', 'wind'], 'north-temperate': ['road', 'field'],
  'north-river': ['water', 'road'], 'north-moor': ['open', 'wind'],
  'mountain-cold': ['snow', 'rock'], 'mountain-pass': ['rock', 'road'],
  'river-lowland': ['water', 'field'], 'forest-edge': ['forest', 'road'],
  woodland: ['forest', 'shade'], shoreline: ['water', 'shore'],
});

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function digest(value) {
  let hash = 2166136261;
  const source = stable(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function getSettlementWorldCoverageContinuityProfile(serviceId, stage, context) {
  if (!SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SERVICES.includes(serviceId)) return null;
  if (!SETTLEMENT_WORLD_COVERAGE_CONTINUITY_STAGES.includes(stage)) return null;
  if (!SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CONTEXTS.includes(context)) return null;
  const base = PROFILE_BY_SERVICE[serviceId];
  const tags = CONTEXT_TAGS[context];
  const stageMultiplier = STAGE_MULTIPLIER[stage];
  const contextMultiplier = CONTEXT_MULTIPLIER[context];
  const density = Math.round(base.density * stageMultiplier * contextMultiplier * 1000) / 1000;
  const readable = stage !== 'far' || base.focus === 'route';
  const priority = Math.round((density + (serviceId === 'gate' && stage === 'threshold' ? 0.2 : 0)) * 1000) / 1000;
  return Object.freeze({
    id: `${serviceId}:${stage}:${context}`,
    serviceId, stage, context,
    focus: base.focus,
    icon: base.icon,
    audio: base.audio,
    tags: Object.freeze([...tags]),
    density,
    readable,
    priority,
    mobileDensity: Math.round(density * 0.62 * 1000) / 1000,
  });
}

export function buildSettlementWorldCoverageContinuityCatalogue() {
  const rows = [];
  for (const serviceId of SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SERVICES) {
    for (const stage of SETTLEMENT_WORLD_COVERAGE_CONTINUITY_STAGES) {
      for (const context of SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CONTEXTS) {
        rows.push(getSettlementWorldCoverageContinuityProfile(serviceId, stage, context));
      }
    }
  }
  return Object.freeze(rows);
}

export function findSettlementWorldCoverageContinuityProfiles({ serviceId = null, stage = null, context = null } = {}) {
  return Object.freeze(buildSettlementWorldCoverageContinuityCatalogue().filter((row) =>
    (serviceId == null || row.serviceId === serviceId) &&
    (stage == null || row.stage === stage) &&
    (context == null || row.context === context),
  ));
}

export function validateSettlementWorldCoverageContinuityCatalogue() {
  const rows = buildSettlementWorldCoverageContinuityCatalogue();
  const expected = SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SERVICES.length
    * SETTLEMENT_WORLD_COVERAGE_CONTINUITY_STAGES.length
    * SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CONTEXTS.length;
  const errors = [];
  if (rows.length !== expected) errors.push('catalogue-cardinality');
  if (new Set(rows.map((row) => row.id)).size !== rows.length) errors.push('catalogue-duplicate-id');
  if (rows.some((row) => row.density < 0 || row.density > 1)) errors.push('catalogue-density-range');
  if (rows.some((row) => row.mobileDensity < 0 || row.mobileDensity > 1)) errors.push('catalogue-mobile-density-range');
  for (const row of rows) if (!row.tags.length) errors.push(`catalogue-tags:${row.id}`);
  return Object.freeze({ ok: errors.length === 0, errors, count: rows.length, expected, fingerprint: digest(rows) });
}

export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CATALOG_API = Object.freeze({
  version: 1,
  serviceCount: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SERVICES.length,
  stageCount: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_STAGES.length,
  contextCount: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CONTEXTS.length,
  generatedProfileCount: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SERVICES.length
    * SETTLEMENT_WORLD_COVERAGE_CONTINUITY_STAGES.length
    * SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CONTEXTS.length,
});
