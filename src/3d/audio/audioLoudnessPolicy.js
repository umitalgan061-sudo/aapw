/**
 * Bounded loudness normalization policy.
 *
 * Game audio often combines authored assets, procedural layers and UI cues from different amplitude
 * conventions. This pure policy keeps channel output in a stable perceived envelope and prevents a single
 * source class from consuming the entire dynamic range. It is not a measurement microphone and it does
 * not claim to calibrate an individual user's hearing; it simply applies transparent engineering limits.
 */

const CLASSES = Object.freeze({ MUSIC: 'music', AMBIENCE: 'ambience', WEATHER: 'weather', WATER: 'water', NPC: 'npc', PLAYER: 'player', COMBAT: 'combat', DIALOGUE: 'dialogue', UI: 'ui', DEBUG: 'debug' });
const TARGETS_DB = Object.freeze({ music: -18, ambience: -28, weather: -26, water: -28, npc: -26, player: -24, combat: -20, dialogue: -16, ui: -20, debug: -32 });
const MAX_GAIN = Object.freeze({ music: 1, ambience: 0.8, weather: 0.75, water: 0.75, npc: 0.85, player: 0.95, combat: 1, dialogue: 1, ui: 0.95, debug: 0.4 });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };

function safeClass(value) { return Object.values(CLASSES).includes(value) ? value : CLASSES.AMBIENCE; }
function linearFromDb(db) { return Math.pow(10, db / 20); }
function dbFromLinear(linear) { return 20 * Math.log10(Math.max(linear, 0.000001)); }

export function normalizeAudioLoudness({ class: sourceClass, measuredPeakDb = -24, measuredRmsDb = -34, gain = 1, headroomDb = 3, critical = false } = {}) {
	const key = safeClass(sourceClass);
	const peak = finiteOr(measuredPeakDb, -24);
	const rms = finiteOr(measuredRmsDb, peak - 10);
	const target = TARGETS_DB[key];
	const max = MAX_GAIN[key];
	const desiredDb = target - rms;
	const desiredLinear = linearFromDb(desiredDb);
	const peakHeadroom = headroomDb - Math.max(0, peak + headroomDb);
	const peakLimiter = linearFromDb(peakHeadroom);
	const base = clamp(finiteOr(gain, 1), 0, 1);
	let output = clamp(base * Math.min(desiredLinear, Math.max(0.1, peakLimiter)), 0, max);
	if (critical) output = Math.max(output, Math.min(max, base * 0.5));
	return freeze({ version: 1, class: key, targetDb: target, measuredPeakDb: peak, measuredRmsDb: rms, inputGain: base, normalizationGain: Number(clamp(output / Math.max(base, 0.000001), 0, 2).toFixed(6)), outputGain: Number(output.toFixed(6)), estimatedOutputRmsDb: Number((rms + dbFromLinear(Math.max(output / Math.max(base, 0.000001), 0.000001))).toFixed(3)), critical });
}

export function loudnessBalance(channels = []) {
	const decisions = channels.map((channel) => normalizeAudioLoudness(channel));
	const criticalMax = decisions.filter((item) => item.critical).reduce((max, item) => Math.max(max, item.outputGain), 0);
	return freeze({ version: 1, count: decisions.length, criticalMax, channels: decisions });
}

export function applyLoudnessGain(gain, normalization) {
	return clamp(finiteOr(gain, 0) * finiteOr(normalization?.normalizationGain, 1), 0, 1);
}

export function loudnessPolicyConstants() { return freeze({ classes: CLASSES, targetsDb: TARGETS_DB, maxGain: MAX_GAIN }); }
