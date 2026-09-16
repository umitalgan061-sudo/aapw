/**
 * Weather audio mixer.
 *
 * Translates normalized weather observations into continuous layer targets and transient opportunities.
 * The weather system remains authoritative; this module merely converts intensity/type into acoustic
 * parameters. It supports drizzle, rain, heavy rain, storm, snow and clear states and provides thunder
 * cadence suggestions without owning a timer.
 */

const TYPES = Object.freeze(['clear', 'drizzle', 'rain', 'heavy-rain', 'storm', 'snow']);
const PROFILES = Object.freeze({
	clear: { rain: 0, wind: 0.05, low: 0, thunder: 0, brightness: 1 },
	drizzle: { rain: 0.2, wind: 0.16, low: 0.02, thunder: 0.02, brightness: 0.92 },
	rain: { rain: 0.48, wind: 0.24, low: 0.06, thunder: 0.06, brightness: 0.82 },
	'heavy-rain': { rain: 0.72, wind: 0.38, low: 0.1, thunder: 0.14, brightness: 0.7 },
	storm: { rain: 0.9, wind: 0.72, low: 0.18, thunder: 0.52, brightness: 0.58 },
	snow: { rain: 0.04, wind: 0.3, low: 0.08, thunder: 0, brightness: 0.86 },
});
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };
function type(value) { return TYPES.includes(value) ? value : 'clear'; }

export function createWeatherAudioState({ type: weatherType = 'clear', intensity = 0, gust = 0, wetness = null, temperature = 12 } = {}) {
	const kind = type(weatherType);
	const profile = PROFILES[kind];
	const strength = clamp(finiteOr(intensity, 0), 0, 1);
	const gustFactor = clamp(finiteOr(gust, 0), 0, 1);
	const humidity = wetness === null ? strength : clamp(finiteOr(wetness, strength), 0, 1);
	return freeze({ version: 1, type: kind, intensity: strength, temperature: finiteOr(temperature, 12), layers: { rain: clamp(profile.rain * strength, 0, 1), wind: clamp(profile.wind * (0.35 + strength * 0.85) + gustFactor * 0.2, 0, 1), lowRumble: clamp(profile.low * strength, 0, 1), wetness: humidity, brightness: profile.brightness }, thunder: { opportunity: clamp(profile.thunder * strength + gustFactor * 0.08, 0, 1), preferredCooldownSeconds: kind === 'storm' ? 9 : 25 } });
}

export function transitionWeatherAudio(previous = {}, next = {}, deltaSeconds = 0.016) {
	const t = clamp(finiteOr(deltaSeconds, 0.016) * 2.5, 0, 1);
	const blend = (a, b) => finiteOr(a, 0) + (finiteOr(b, 0) - finiteOr(a, 0)) * t;
	return freeze({ version: 1, layers: { rain: blend(previous.layers?.rain, next.layers?.rain), wind: blend(previous.layers?.wind, next.layers?.wind), lowRumble: blend(previous.layers?.lowRumble, next.layers?.lowRumble), wetness: blend(previous.layers?.wetness, next.layers?.wetness), brightness: blend(previous.layers?.brightness ?? 1, next.layers?.brightness ?? 1) }, thunder: { opportunity: blend(previous.thunder?.opportunity, next.thunder?.opportunity), preferredCooldownSeconds: blend(previous.thunder?.preferredCooldownSeconds ?? 25, next.thunder?.preferredCooldownSeconds ?? 25) } });
}

export function weatherThunderGain(state, seedPhase = 0) {
	const opportunity = clamp(finiteOr(state?.thunder?.opportunity, 0), 0, 1);
	const phase = finiteOr(seedPhase, 0);
	const envelope = 0.5 + 0.5 * Math.sin(phase * 2.173);
	return Number((opportunity * envelope).toFixed(5));
}

export function weatherAudioConstants() { return freeze({ types: TYPES, profiles: PROFILES }); }
