/**
 * Compatibility barrel for legacy JavaScript imports.
 *
 * The authoritative dragon configuration now lives in `dragonConfig.ts`. The public import path
 * stays unchanged during the TS-first migration.
 * @module gameplay/dragonConfig
 */
export { DRAGON_CONFIG, validateDragonConfig } from './dragonConfig.ts';
