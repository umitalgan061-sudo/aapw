/**
 * Compatibility barrel for legacy JavaScript imports.
 *
 * The authoritative 3D configuration now lives in config.ts. Keeping this import path preserves
 * the existing browser/runtime module graph while making TypeScript the source of truth.
 * @module config
 */
export * from './config.ts';
