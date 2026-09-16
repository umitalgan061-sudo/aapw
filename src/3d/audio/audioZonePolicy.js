/**
 * Deterministic spatial audio zone policy.
 *
 * Zones provide reusable acoustic overrides for locations such as castle courtyards, great halls, caves,
 * shorelines and exposed fields. They are descriptions only; the world owner decides which zones the
 * player is inside and supplies the candidate list. The resolver then blends overlapping zones by priority
 * and distance without touching scene objects.
 */

const ZONE_TYPES = Object.freeze({ OPEN: 'open', HALL: 'hall', CAVE: 'cave', COURTYARD: 'courtyard', SHORE: 'shore', FOREST: 'forest', UNDERWATER: 'underwater', SETTLEMENT: 'settlement' });
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const type = (value) => Object.values(ZONE_TYPES).includes(value) ? value : ZONE_TYPES.OPEN;

const MODIFIERS = Object.freeze({
	open: { reverb: 0.05, low: 0, ambience: 1 },
	hall: { reverb: 0.36, low: 0.08, ambience: 0.9 },
	cave: { reverb: 0.62, low: 0.18, ambience: 0.78 },
	courtyard: { reverb: 0.2, low: 0.03, ambience: 0.92 },
	shore: { reverb: 0.08, low: -0.02, ambience: 1.05 },
	forest: { reverb: 0.12, low: 0.02, ambience: 1.08 },
	underwater: { reverb: 0.78, low: 0.25, ambience: 0.68 },
	settlement: { reverb: 0.22, low: 0.04, ambience: 1.16 },
});

export function createAudioZone(input = {}) {
	const zoneType = type(input.type);
	return freeze({ version: 1, id: String(input.id ?? 'zone').slice(0, 96), type: zoneType, priority: clamp(Math.round(finiteOr(input.priority, 10)), 0, 100), radius: clamp(finiteOr(input.radius, 20), 1, 1000), fade: clamp(finiteOr(input.fade, 6), 0.5, 200), modifiers: { ...MODIFIERS[zoneType] }, center: { x: finiteOr(input.center?.x, 0), y: finiteOr(input.center?.y, 0), z: finiteOr(input.center?.z, 0) } });
}

export function evaluateZoneInfluence(zone, position) {
	if (!zone) return { influence: 0, distance: Infinity };
	const p = position ?? { x: 0, y: 0, z: 0 };
	const distance = Math.hypot(finiteOr(zone.center?.x, 0) - finiteOr(p.x, 0), finiteOr(zone.center?.y, 0) - finiteOr(p.y, 0), finiteOr(zone.center?.z, 0) - finiteOr(p.z, 0));
	const radius = Math.max(1, finiteOr(zone.radius, 20));
	const fade = Math.max(0.5, finiteOr(zone.fade, 6));
	const influence = distance <= radius ? 1 : distance >= radius + fade ? 0 : 1 - (distance - radius) / fade;
	return freeze({ influence: Number(clamp(influence, 0, 1).toFixed(5)), distance: Number(distance.toFixed(4)) });
}

export function resolveAudioZones(zones = [], position) {
	const candidates = zones.map((zone) => ({ zone, ...evaluateZoneInfluence(zone, position) })).filter((item) => item.influence > 0).sort((a, b) => b.zone.priority - a.zone.priority || b.influence - a.influence || a.zone.id.localeCompare(b.zone.id));
	const selected = candidates.slice(0, 4);
	let total = selected.reduce((sum, item) => sum + item.influence, 0) || 1;
	const blended = { reverb: 0, low: 0, ambience: 1 };
	for (const item of selected) {
		const weight = item.influence / total;
		blended.reverb += item.zone.modifiers.reverb * weight;
		blended.low += item.zone.modifiers.low * weight;
		blended.ambience *= 1 + (item.zone.modifiers.ambience - 1) * weight;
	}
	return freeze({ version: 1, activeCount: selected.length, zones: selected.map((item) => ({ id: item.zone.id, type: item.zone.type, priority: item.zone.priority, influence: item.influence })), modifiers: { reverb: Number(clamp(blended.reverb, 0, 1).toFixed(5)), low: Number(clamp(blended.low, -0.3, 0.5).toFixed(5)), ambience: Number(clamp(blended.ambience, 0, 2).toFixed(5)) } });
}

export function audioZoneConstants() { return freeze({ types: ZONE_TYPES, modifiers: MODIFIERS }); }
