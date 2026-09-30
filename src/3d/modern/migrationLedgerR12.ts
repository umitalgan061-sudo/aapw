/** R12 production migration registry. Legacy files are rollback-only; active owners are TypeScript. */
export const R12_MIGRATION_MODULES = Object.freeze([
  { id: 'player-directional-locomotion', typedPath: 'src/3d/gameplay/playerDirectionalLocomotionPolicy.ts', legacyPath: 'src/3d/gameplay/playerDirectionalLocomotionPolicy.legacy.js', domain: 'gameplay' },
  { id: 'fauna-population-director', typedPath: 'src/3d/gameplay/livingWorldFaunaPopulationDirector.ts', legacyPath: 'src/3d/gameplay/livingWorldFaunaPopulationDirector.legacy.js', domain: 'gameplay' },
  { id: 'player-animation-temporal', typedPath: 'src/3d/gameplay/playerAnimationTemporalPolicy.ts', legacyPath: 'src/3d/gameplay/playerAnimationTemporalPolicy.legacy.js', domain: 'gameplay' },
  { id: 'living-world-reaction-projection', typedPath: 'src/3d/gameplay/livingWorldReactionProjection.ts', legacyPath: 'src/3d/gameplay/livingWorldReactionProjection.legacy.js', domain: 'gameplay' },
  { id: 'living-world-reaction-ledger', typedPath: 'src/3d/gameplay/livingWorldReactionLedger.ts', legacyPath: 'src/3d/gameplay/livingWorldReactionLedger.legacy.js', domain: 'gameplay' },
  { id: 'settlement-campaign-content', typedPath: 'src/3d/gameplay/settlementCampaignContent.ts', legacyPath: 'src/3d/gameplay/settlementCampaignContent.legacy.js', domain: 'gameplay' },
  { id: 'settlement-campaign-runtime', typedPath: 'src/3d/gameplay/settlementCampaignRuntime.ts', legacyPath: 'src/3d/gameplay/settlementCampaignRuntime.legacy.js', domain: 'gameplay' },
  { id: 'locomotion-state-timeline', typedPath: 'src/3d/gameplay/playerLocomotionStateTimeline.ts', legacyPath: 'src/3d/gameplay/playerLocomotionStateTimeline.legacy.js', domain: 'gameplay' },
  { id: 'locomotion-anticipation-policy', typedPath: 'src/3d/gameplay/playerLocomotionAnticipationPolicy.ts', legacyPath: 'src/3d/gameplay/playerLocomotionAnticipationPolicy.legacy.js', domain: 'gameplay' },
  { id: 'living-world-runtime-evidence', typedPath: 'src/3d/gameplay/livingWorldRuntimeEvidence.ts', legacyPath: 'src/3d/gameplay/livingWorldRuntimeEvidence.legacy.js', domain: 'gameplay' },
  { id: 'settlement-world-coverage-continuity', typedPath: 'src/3d/gameplay/settlementWorldCoverageContinuity.ts', legacyPath: 'src/3d/gameplay/settlementWorldCoverageContinuity.legacy.js', domain: 'gameplay' },
  { id: 'natural-geology', typedPath: 'src/3d/world/naturalGeology.ts', legacyPath: 'src/3d/world/naturalGeology.legacy.js', domain: 'world' },
  { id: 'terrain-macro-weathering', typedPath: 'src/3d/world/terrainMacroWeathering.ts', legacyPath: 'src/3d/world/terrainMacroWeathering.legacy.js', domain: 'world' },
  { id: 'world-reference-mountain-relief', typedPath: 'src/3d/world/worldReferenceMountainRelief.ts', legacyPath: 'src/3d/world/worldReferenceMountainRelief.legacy.js', domain: 'world' },
  { id: 'world-reference-scene-shadow', typedPath: 'src/3d/world/worldReferenceSceneShadowAdapter.ts', legacyPath: 'src/3d/world/worldReferenceSceneShadowAdapter.legacy.js', domain: 'world' },
  { id: 'editor-material-studio', typedPath: 'src/3d/editor/EditorMaterialStudio.ts', legacyPath: 'src/3d/editor/EditorMaterialStudio.legacy.js', domain: 'editor' },
] as const);

export interface R12MigrationSnapshot {
  readonly version: 12;
  readonly totalModules: number;
  readonly domains: Readonly<Record<string, number>>;
}

export function getR12MigrationSnapshot(): R12MigrationSnapshot {
  const domains: Record<string, number> = {};
  for (const module of R12_MIGRATION_MODULES) domains[module.domain] = (domains[module.domain] ?? 0) + 1;
  return Object.freeze({
    version: 12,
    totalModules: R12_MIGRATION_MODULES.length,
    domains: Object.freeze(domains),
  });
}
