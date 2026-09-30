/** R11 gameplay runtime ownership ledger. */
export const R11_GAMEPLAY_MIGRATION = Object.freeze([
  ['interaction', 'src/3d/gameplay/interaction.js', 'src/3d/gameplay/interaction.ts'],
  ['player', 'src/3d/gameplay/player.js', 'src/3d/gameplay/player.ts'],
  ['npc', 'src/3d/gameplay/npc.js', 'src/3d/gameplay/npc.ts'],
  ['animals', 'src/3d/gameplay/animals.js', 'src/3d/gameplay/animals.ts'],
  ['dragon-controller', 'src/3d/gameplay/dragonController.js', 'src/3d/gameplay/dragonController.ts'],
  ['dragon-config', 'src/3d/gameplay/dragonConfig.js', 'src/3d/gameplay/dragonConfig.ts'],
  ['creature-brain', 'src/3d/gameplay/creatureBrain.js', 'src/3d/gameplay/creatureBrain.ts'],
  ['cart-brain', 'src/3d/gameplay/cartBrain.js', 'src/3d/gameplay/cartBrain.ts'],
  ['living-world-spawner', 'src/3d/gameplay/livingWorldSpawner.js', 'src/3d/gameplay/livingWorldSpawner.ts'],
  ['world-events', 'src/3d/gameplay/worldEvents.js', 'src/3d/gameplay/worldEvents.ts'],
  ['interaction-field-readiness', 'src/3d/gameplay/interactionFieldReadiness.js', 'src/3d/gameplay/interactionFieldReadiness.ts'],
  ['creature-locomotion-synthesis', 'src/3d/gameplay/creatureLocomotionStateSynthesis.js', 'src/3d/gameplay/creatureLocomotionStateSynthesis.ts'],
  ['player-locomotion-synthesis', 'src/3d/gameplay/playerLocomotionStateSynthesis.js', 'src/3d/gameplay/playerLocomotionStateSynthesis.ts'],
] as const);

export function getR11GameplayCoverage() {
  const total = R11_GAMEPLAY_MIGRATION.length;
  return Object.freeze({ version: 11, total, migrated: total, coveragePercent: 100 });
}
