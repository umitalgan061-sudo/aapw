/**
 * Geometry-driven audio occlusion policy.
 *
 * Ray tests belong to the camera/world collision owners. They feed this module only a compact result
 * (blocked, surface count, estimated thickness and optional material class). The policy then converts
 * that information into gain, low-pass cutoff and reverb send guidance. It deliberately performs no
 * Three.js raycast, no DOM work and no network access.
 */

const MATERIALS = Object.freeze({ STONE: 'stone', WOOD: 'wood', EARTH: 'earth', METAL: 'metal', ICE: 'ice', FOLIAGE: 'foliage', WATER: 'water', UNKNOWN: 'unknown' });
const DEFAULTS = Object.freeze({ blockedGain: 0.28, cutoffHz: 950, minCutoffHz: 180, clearCutoffHz: 18000 });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };
function material(value) { return Object.values(MATERIALS).includes(value) ? value : MATERIALS.UNKNOWN; }
function materialFactor(value) { return ({ stone: 0.72, wood: 0.58, earth: 0.66, metal: 0.8, ice: 0.5, foliage: 0.38, water: 0.28, unknown: 0.62 })[value] ?? 0.62; }
function thicknessFactor(thickness) { return clamp(finiteOr(thickness, 0) / 8, 0, 1); }
function surfaceFactor(count) { return clamp(Math.max(0, Math.round(finiteOr(count, 0))) / 4, 0, 1); }

export function evaluateAudioOcclusion(input = {}) {
	const blocked = input.blocked === true;
	const materialClass = material(input.material);
	if (!blocked) return freeze({ version: 1, blocked: false, gain: 1, cutoffHz: DEFAULTS.clearCutoffHz, reverbSend: 0, severity: 0, material: MATERIALS.UNKNOWN, surfaceCount: 0, thickness: 0 });
	const thickness = thicknessFactor(input.thicknessMeters);
	const surfaces = surfaceFactor(input.surfaceCount);
	const materialAbsorption = materialFactor(materialClass);
	const severity = clamp(0.35 + thickness * 0.35 + surfaces * 0.2 + materialAbsorption * 0.1, 0.1, 1);
	const gain = clamp(1 - severity * (1 - DEFAULTS.blockedGain), 0.04, 0.9);
	const cutoff = clamp(DEFAULTS.clearCutoffHz - severity * (DEFAULTS.clearCutoffHz - DEFAULTS.minCutoffHz), DEFAULTS.minCutoffHz, DEFAULTS.clearCutoffHz);
	const reverbSend = clamp(severity * 0.65, 0, 0.8);
	return freeze({ version: 1, blocked: true, gain: Number(gain.toFixed(5)), cutoffHz: Math.round(cutoff), reverbSend: Number(reverbSend.toFixed(5)), severity: Number(severity.toFixed(5)), material: materialClass, surfaceCount: Math.max(0, Math.round(finiteOr(input.surfaceCount, 0))), thickness: Number(Math.max(0, finiteOr(input.thicknessMeters, 0)).toFixed(3)) });
}

export function smoothOcclusion(previous = {}, next = {}, dt = 0.016, attack = 10, release = 5) {
	const t = clamp(Math.max(0, finiteOr(dt, 0)) * (next?.severity > previous?.severity ? attack : release), 0, 1);
	return freeze({ version: 1, gain: finiteOr(previous.gain, 1) + (finiteOr(next.gain, 1) - finiteOr(previous.gain, 1)) * t, cutoffHz: finiteOr(previous.cutoffHz, DEFAULTS.clearCutoffHz) + (finiteOr(next.cutoffHz, DEFAULTS.clearCutoffHz) - finiteOr(previous.cutoffHz, DEFAULTS.clearCutoffHz)) * t, reverbSend: finiteOr(previous.reverbSend, 0) + (finiteOr(next.reverbSend, 0) - finiteOr(previous.reverbSend, 0)) * t, severity: finiteOr(previous.severity, 0) + (finiteOr(next.severity, 0) - finiteOr(previous.severity, 0)) * t });
}

export function audioMaterialAbsorption(materialName) { return materialFactor(material(materialName)); }
export function audioOcclusionConstants() { return freeze({ materials: MATERIALS, defaults: DEFAULTS }); }
