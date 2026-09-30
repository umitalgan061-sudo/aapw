import { readFile, stat } from 'node:fs/promises';

const owners = [
  ['src/3d/gameplay/playerDirectionalLocomotionPolicy.ts', 'src/3d/gameplay/playerDirectionalLocomotionPolicy.js', 'src/3d/gameplay/playerDirectionalLocomotionPolicy.legacy.js'],
  ['src/3d/gameplay/livingWorldFaunaPopulationDirector.ts', 'src/3d/gameplay/livingWorldFaunaPopulationDirector.js', 'src/3d/gameplay/livingWorldFaunaPopulationDirector.legacy.js'],
  ['src/3d/gameplay/playerAnimationTemporalPolicy.ts', 'src/3d/gameplay/playerAnimationTemporalPolicy.js', 'src/3d/gameplay/playerAnimationTemporalPolicy.legacy.js'],
  ['src/3d/gameplay/livingWorldReactionProjection.ts', 'src/3d/gameplay/livingWorldReactionProjection.js', 'src/3d/gameplay/livingWorldReactionProjection.legacy.js'],
  ['src/3d/gameplay/livingWorldReactionLedger.ts', 'src/3d/gameplay/livingWorldReactionLedger.js', 'src/3d/gameplay/livingWorldReactionLedger.legacy.js'],
  ['src/3d/gameplay/settlementCampaignContent.ts', 'src/3d/gameplay/settlementCampaignContent.js', 'src/3d/gameplay/settlementCampaignContent.legacy.js'],
  ['src/3d/gameplay/settlementCampaignRuntime.ts', 'src/3d/gameplay/settlementCampaignRuntime.js', 'src/3d/gameplay/settlementCampaignRuntime.legacy.js'],
  ['src/3d/gameplay/playerLocomotionStateTimeline.ts', 'src/3d/gameplay/playerLocomotionStateTimeline.js', 'src/3d/gameplay/playerLocomotionStateTimeline.legacy.js'],
  ['src/3d/gameplay/playerLocomotionAnticipationPolicy.ts', 'src/3d/gameplay/playerLocomotionAnticipationPolicy.js', 'src/3d/gameplay/playerLocomotionAnticipationPolicy.legacy.js'],
  ['src/3d/gameplay/livingWorldRuntimeEvidence.ts', 'src/3d/gameplay/livingWorldRuntimeEvidence.js', 'src/3d/gameplay/livingWorldRuntimeEvidence.legacy.js'],
  ['src/3d/gameplay/settlementWorldCoverageContinuity.ts', 'src/3d/gameplay/settlementWorldCoverageContinuity.js', 'src/3d/gameplay/settlementWorldCoverageContinuity.legacy.js'],
  ['src/3d/world/naturalGeology.ts', 'src/3d/world/naturalGeology.js', 'src/3d/world/naturalGeology.legacy.js'],
  ['src/3d/world/terrainMacroWeathering.ts', 'src/3d/world/terrainMacroWeathering.js', 'src/3d/world/terrainMacroWeathering.legacy.js'],
  ['src/3d/world/worldReferenceMountainRelief.ts', 'src/3d/world/worldReferenceMountainRelief.js', 'src/3d/world/worldReferenceMountainRelief.legacy.js'],
  ['src/3d/world/worldReferenceSceneShadowAdapter.ts', 'src/3d/world/worldReferenceSceneShadowAdapter.js', 'src/3d/world/worldReferenceSceneShadowAdapter.legacy.js'],
  ['src/3d/editor/EditorMaterialStudio.ts', 'src/3d/editor/EditorMaterialStudio.js', 'src/3d/editor/EditorMaterialStudio.legacy.js'],
];

const failures = [];
for (const [typed, shim, legacy] of owners) {
  const [typedText, shimText, legacyText] = await Promise.all([
    readFile(typed, 'utf8').catch(() => null),
    readFile(shim, 'utf8').catch(() => null),
    readFile(legacy, 'utf8').catch(() => null),
  ]);
  if (!typedText) { failures.push(`${typed}: missing production TypeScript owner`); continue; }
  if (typedText.length < 1200) failures.push(`${typed}: production owner is suspiciously small`);
  if (typedText.includes('.legacy.js')) failures.push(`${typed}: production owner references rollback payload`);
  if (!shimText || !shimText.includes('export * from') || !shimText.includes(typed.split('/').pop())) failures.push(`${shim}: invalid TypeScript compatibility boundary`);
  if (!legacyText || legacyText.length < 1000) failures.push(`${legacy}: rollback payload unexpectedly missing/truncated`);
  if (typedText.includes('Math.random(')) failures.push(`${typed}: ambient Math.random is forbidden in deterministic production policy`);
}

if (failures.length) {
  console.error(`R12 typed ownership check failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`R12 typed ownership check passed for ${owners.length} production modules.`);
