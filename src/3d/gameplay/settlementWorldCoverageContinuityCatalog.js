/**
 * Canonical transition profile catalogue for Settlement World Coverage.
 *
 * Each profile describes a deterministic presentation hint for one service,
 * transition stage and environmental context. The catalogue is declarative:
 * it never mutates the world or settlement runtime. It exists so the bridge
 * can make consistent choices without hard-coding UI/runtime branches.
 */
export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CONTEXTS = Object.freeze([
  'north-cold',
  'north-temperate',
  'north-river',
  'north-moor',
  'mountain-cold',
  'mountain-pass',
  'river-lowland',
  'forest-edge',
  'woodland',
  'shoreline',
]);
export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CATALOG = Object.freeze([
EOF
