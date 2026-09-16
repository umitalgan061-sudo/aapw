/**
 * Semantic sound design catalog.
 *
 * Defines the acoustic role of each supported gameplay sound rather than binding gameplay to filenames.
 * This gives authored assets a stable future insertion point while procedural fallback remains available.
 * Values are deliberately human-auditable and bounded.
 */

const CATALOG = Object.freeze({
	player: Object.freeze({ family: 'actor', nearDb: -12, farDb: -34, attackMs: 8, releaseMs: 90, maxInstances: 4, spatial: true, transient: false, critical: true }),
	footstep: Object.freeze({ family: 'locomotion', nearDb: -18, farDb: -42, attackMs: 4, releaseMs: 60, maxInstances: 6, spatial: true, transient: true, critical: false }),
	combat_hit: Object.freeze({ family: 'combat', nearDb: -10, farDb: -32, attackMs: 2, releaseMs: 90, maxInstances: 8, spatial: true, transient: true, critical: true }),
	combat_swing: Object.freeze({ family: 'combat', nearDb: -16, farDb: -40, attackMs: 5, releaseMs: 120, maxInstances: 6, spatial: true, transient: true, critical: false }),
	dragon_roar: Object.freeze({ family: 'creature', nearDb: -8, farDb: -30, attackMs: 30, releaseMs: 700, maxInstances: 2, spatial: true, transient: false, critical: true }),
	dragon_attack: Object.freeze({ family: 'creature', nearDb: -10, farDb: -32, attackMs: 12, releaseMs: 300, maxInstances: 3, spatial: true, transient: true, critical: true }),
	water: Object.freeze({ family: 'environment', nearDb: -28, farDb: -48, attackMs: 400, releaseMs: 1200, maxInstances: 3, spatial: true, transient: false, critical: false }),
	wind: Object.freeze({ family: 'environment', nearDb: -30, farDb: -50, attackMs: 900, releaseMs: 1400, maxInstances: 2, spatial: false, transient: false, critical: false }),
	rain: Object.freeze({ family: 'weather', nearDb: -26, farDb: -46, attackMs: 600, releaseMs: 1100, maxInstances: 2, spatial: false, transient: false, critical: false }),
	thunder: Object.freeze({ family: 'weather', nearDb: -9, farDb: -34, attackMs: 10, releaseMs: 1100, maxInstances: 2, spatial: true, transient: true, critical: false }),
	fire: Object.freeze({ family: 'environment', nearDb: -26, farDb: -48, attackMs: 300, releaseMs: 700, maxInstances: 2, spatial: true, transient: false, critical: false }),
	settlement: Object.freeze({ family: 'social', nearDb: -24, farDb: -44, attackMs: 500, releaseMs: 900, maxInstances: 3, spatial: true, transient: false, critical: false }),
	ui_click: Object.freeze({ family: 'interface', nearDb: -18, farDb: -18, attackMs: 1, releaseMs: 45, maxInstances: 3, spatial: false, transient: true, critical: true }),
	discovery: Object.freeze({ family: 'interface', nearDb: -14, farDb: -14, attackMs: 3, releaseMs: 400, maxInstances: 2, spatial: false, transient: true, critical: true }),	
	menu_open: Object.freeze({ family: 'interface', nearDb: -20, farDb: -20, attackMs: 4, releaseMs: 100, maxInstances: 2, spatial: false, transient: true, critical: false }),
	menu_close: Object.freeze({ family: 'interface', nearDb: -22, farDb: -22, attackMs: 4, releaseMs: 90, maxInstances: 2, spatial: false, transient: true, critical: false }),
	victory: Object.freeze({ family: 'music', nearDb: -16, farDb: -16, attackMs: 30, releaseMs: 1200, maxInstances: 1, spatial: false, transient: false, critical: true }),
	defeat: Object.freeze({ family: 'music', nearDb: -14, farDb: -14, attackMs: 20, releaseMs: 1000, maxInstances: 1, spatial: false, transient: false, critical: true }),
});

const FAMILY_LIMITS = Object.freeze({ actor: 6, locomotion: 8, combat: 12, creature: 4, environment: 8, weather: 5, social: 5, interface: 5, music: 2 });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };

export function getAudioDesign(key) { return CATALOG[key] ? freeze({ ...CATALOG[key] }) : null; }
export function listAudioDesignKeys() { return Object.keys(CATALOG); }
export function familyInstanceLimit(family) { return clamp(Math.round(Number(FAMILY_LIMITS[family] ?? 1)), 1, 32); }
export function audioDesignFamily(key) { return CATALOG[key]?.family ?? 'unknown'; }
export function audioDesignSupportsSpatial(key) { return CATALOG[key]?.spatial === true; }
export function audioDesignIsCritical(key) { return CATALOG[key]?.critical === true; }
export function audioDesignMaxInstances(key) { return clamp(Math.round(Number(CATALOG[key]?.maxInstances ?? 1)), 1, 32); }
export function validateAudioDesign(key, patch = {}) {
	const design = CATALOG[key];
	if (!design) return freeze({ valid: false, key, errors: ['unknown-design'] });
	const errors = [];
	if (Number.isFinite(patch.nearDb) && patch.nearDb > 0) errors.push('nearDb-must-be-non-positive');
	if (Number.isFinite(patch.farDb) && patch.farDb > 0) errors.push('farDb-must-be-non-positive');
	if (Number.isFinite(patch.maxInstances) && (patch.maxInstances < 1 || patch.maxInstances > 32)) errors.push('maxInstances-out-of-range');
	if (patch.spatial === true && patch.family === 'interface') errors.push('interface-cue-should-not-be-positional');
	return freeze({ valid: errors.length === 0, key, family: design.family, errors, effective: { ...design, ...patch } });
}

export function mergeAudioDesignCatalog(patches = {}) {
	const output = {};
	for (const key of Object.keys(CATALOG)) output[key] = freeze({ ...CATALOG[key], ...(patches[key] ?? {}) });
	return freeze(output);
}

export function audioDesignCatalogConstants() { return freeze({ catalog: CATALOG, familyLimits: FAMILY_LIMITS }); }
