/**
 * Compatibility barrel for legacy JavaScript imports.
 *
 * The authoritative player configuration now lives in `playerConfig.ts`. Keeping this module
 * preserves the existing gameplayConfig.js/service-worker import contract during the migration.
 * @module gameplay/playerConfig
 */
export { PLAYER_CONFIG, playerAnimationUrl, playerSpawnMapPosition, validatePlayerConfig } from './playerConfig.ts';
