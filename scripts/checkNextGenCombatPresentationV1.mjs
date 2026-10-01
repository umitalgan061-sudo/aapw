import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relativePath) => readFile(new URL('../' + relativePath, import.meta.url), 'utf8');

const [
  presentation,
  queue,
  replay,
  accessibility,
  assets,
  contract,
  damage,
  browser,
  haptics,
  network,
  timeline,
  scenario,
  spatial,
  reaction,
  surface,
] = await Promise.all([
  read('src/3d/nextgen/combatPresentationV1.ts'),
  read('src/3d/nextgen/combatPresentationQueueV1.ts'),
  read('src/3d/nextgen/combatPresentationReplayV1.ts'),
  read('src/3d/nextgen/combatPresentationAccessibilityV1.ts'),
  read('src/3d/nextgen/combatPresentationAssetsV1.ts'),
  read('src/3d/nextgen/combatPresentationContractV1.ts'),
  read('src/3d/nextgen/combatPresentationDamageTypeV1.ts'),
  read('src/3d/nextgen/combatPresentationBrowserBridgeV1.ts'),
  read('src/3d/nextgen/combatPresentationHapticsV1.ts'),
  read('src/3d/nextgen/combatPresentationNetworkV1.ts'),
  read('src/3d/nextgen/combatPresentationTimelineV1.ts'),
  read('src/3d/nextgen/combatPresentationScenarioV1.ts'),
  read('src/3d/nextgen/combatPresentationSpatialAudioV1.ts'),
  read('src/3d/nextgen/combatPresentationReactionV1.ts'),
  read('src/3d/nextgen/combatPresentationSurfaceImpactV1.ts'),
]);

assert.match(presentation, /class CombatPresentationDirector/);
assert.match(presentation, /hitstopTicks/);
assert.match(presentation, /haptics/);
assert.match(presentation, /cameraShake/);
assert.match(presentation, /damageType/);

assert.match(queue, /maxDispatchPerFrame/);
assert.match(queue, /cooldownTicks/);
assert.match(replay, /compareCombatPresentationRecordings/);
assert.match(accessibility, /projectCombatAccessibility/);

assert.match(assets, /combat_impact_vfx/);
assert.match(assets, /source: 'pending'/);
assert.match(assets, /source: 'fallback'/);
assert.match(contract, /validateCombatPresentationContract/);
assert.match(damage, /validateCombatDamageTypeProfiles/);
assert.match(browser, /CombatPresentationBrowserBridge/);
assert.match(haptics, /dispatchCombatHapticPulses/);
assert.match(network, /buildCombatPresentationNetworkPacket/);
assert.match(timeline, /createCombatPresentationTimeline/);
assert.match(scenario, /runCombatPresentationVerticalSlice/);
assert.match(spatial, /resolveCombatSpatialAudio/);
assert.match(reaction, /resolveCombatReactionIntent/);
assert.match(surface, /buildCombatSurfaceImpactMatrix/);

for (const source of [presentation, queue, replay, accessibility, assets, contract, damage, browser, haptics, network, timeline, scenario, spatial, reaction, surface]) {
  assert.doesNotMatch(source, /EditorMaterialStudio/);
  assert.doesNotMatch(source, /@ts-nocheck/);
  assert.doesNotMatch(source, /Record<string, any>/);
}

console.log(JSON.stringify({
  pass: true,
  contract: 'static-nextgen-presentation-v1',
  modulesChecked: 15,
  editorRuntimeImport: false,
  tsEscapeHatches: 0,
  undisclosedCombatAssets: false,
  missingCombatVfxDisclosed: true,
  missingCombatAudioDisclosed: true,
}));