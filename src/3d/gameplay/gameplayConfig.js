/**
 * Gameplay-system config/constants barrel — re-exports `PLAYER_CONFIG` (FAZ 4), `NPC_CONFIG`
 * (FAZ 5), `ANIMAL_CONFIG` (FAZ 6), `DRAGON_CONFIG` (FAZ 7), and `INTERACTION_CONFIG` (FAZ 5
 * dialogue) from their own per-domain files. Originally extracted verbatim from `config.js` (run
 * 43, DECISIONS.md ADR-0057) as a single file once that file reached its 600-line cap; this file
 * then grew the same way over 34 more runs until it hit 597/600 with zero headroom left for the
 * next gameplay addition (`NPC_CONFIG`'s FAZ 11 combat-stance fields, run 73, were the entry that
 * finally made the ceiling visible).
 *
 * Run 77 (DECISIONS.md ADR-0100) split it by domain into `playerConfig.js`, `npcConfig.js`,
 * `animalConfig.js`, `dragonConfig.js`, `interactionConfig.js` — same "give each domain its own
 * file, re-export through a thin barrel" precedent `gameplay/dragons.js` already set at 600/600
 * (run 71, ADR-0092: split into `dragonController.js`/`dragonFlightMath.js`/`dragonSpawns.js`,
 * `dragons.js` itself staying as the re-exporting facade every caller still imports). This file
 * is now that facade for gameplay config: every one of its 13 existing importers
 * (`import { X } from './gameplayConfig.js'`, or `'./gameplay/gameplayConfig.js'` from outside the
 * folder) keeps working completely unchanged — only this file's own internal shape changed, not
 * its public surface.
 *
 * `config.js` itself keeps everything else (`WORLD_DEFAULTS`, `WORLD_SCALE`, `CHUNK_CONFIG`,
 * `SETTLEMENT_CONFIG`, `EVENTS`, ...) — this file (and its 5 split-out siblings) is gameplay/'s own,
 * matching the blast-radius rule (`gameplay/README.md`: only `gameplay/`, `eventBus.js`,
 * `physics.js`, `input.js` should be touched for a gameplay-system change).
 * @module gameplay/gameplayConfig
 */

export { PLAYER_CONFIG } from './playerConfig.js';
export { NPC_CONFIG } from './npcConfig.js';
export { ANIMAL_CONFIG } from './animalConfig.js';
export { DRAGON_CONFIG } from './dragonConfig.js';
export { INTERACTION_CONFIG } from './interactionConfig.js';
