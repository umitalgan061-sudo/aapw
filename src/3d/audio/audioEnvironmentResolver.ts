// @ts-nocheck
/**
 * Explicit audio environment resolver.
 *
 * Converts already-known world labels and scalar observations into one normalized audio environment
 * request. It does not inspect terrain, collision meshes or scene graphs itself. This prevents sound from
 * silently becoming a second world classifier while still allowing water, night, weather and settlement
 * systems to produce a rich acoustic context.
 */

const ENVIRONMENTS = Object.freeze(['plains', 'forest', 'coast', 'river', 'mountain', 'settlement', 'castle', 'ice', 'night', 'storm', 'unknown']);
const SIGNALS = Object.freeze(['biome', 'nearWater', 'stormIntensity', 'nightFactor', 'windIntensity', 'fireIntensity', 'enclosed', 'material']);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };

function safeEnv(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }

export function resolveAudioEnvironment(input = {}) {
	const biome = safeEnv(input.biome);
	const nearWater = clamp(finiteOr(input.nearWater, 0), 0, 1);
	const stormIntensity = clamp(finiteOr(input.stormIntensity, 0), 0, 1);
	const nightFactor = clamp(finiteOr(input.nightFactor, 0), 0, 1);
	const windIntensity = clamp(finiteOr(input.windIntensity, 1), 0, 2);
	const fireIntensity = clamp(finiteOr(input.fireIntensity, 1), 0, 2);
	const enclosed = clamp(finiteOr(input.enclosed, 0), 0, 1);
	let environment = biome;
	if (stormIntensity >= 0.72) environment = 'storm';
	else if (enclosed >= 0.75 && biome === 'plains') environment = 'castle';
	else if (nightFactor >= 0.86 && biome === 'unknown') environment = 'night';
	else if (nearWater >= 0.8 && biome === 'plains') environment = 'river';
	return freeze({ version: 1, environment, signals: { biome, nearWater, stormIntensity, nightFactor, windIntensity, fireIntensity, enclosed, material: typeof input.material === 'string' ? input.material.slice(0, 32) : 'unknown' }, confidence: environment === biome ? 1 : 0.72 });
}

export function blendAudioEnvironments(a, b, amount = 0.5) {
	const t = clamp(finiteOr(amount, 0.5), 0, 1);
	const keys = SIGNALS;
	const blended = {};
	for (const key of keys) {
		if (key === 'biome' || key === 'material') blended[key] = t < 0.5 ? a?.signals?.[key] : b?.signals?.[key];
		else blended[key] = finiteOr(a?.signals?.[key], 0) + (finiteOr(b?.signals?.[key], 0) - finiteOr(a?.signals?.[key], 0)) * t;
	}
	const resolved = resolveAudioEnvironment(blended);
	return freeze({ ...resolved, blend: { from: a?.environment ?? 'unknown', to: b?.environment ?? 'unknown', amount: t } });
}

export function audioEnvironmentConstants() { return freeze({ environments: ENVIRONMENTS, signals: SIGNALS }); }
