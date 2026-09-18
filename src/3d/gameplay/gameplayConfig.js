/**
 * Compatibility barrel for legacy JavaScript imports.
 *
 * The typed gameplay configuration facade now owns cross-domain validation and diagnostics while
 * preserving every historical `gameplayConfig.js` export for existing runtime callers.
 * @module gameplay/gameplayConfig
 */
export {
  PLAYER_CONFIG,
  NPC_CONFIG,
  ANIMAL_CONFIG,
  DRAGON_CONFIG,
  INTERACTION_CONFIG,
  validateGameplayConfig,
  getGameplayConfigSnapshot,
} from './gameplayConfig.ts';
