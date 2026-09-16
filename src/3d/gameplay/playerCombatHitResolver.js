/**
 * Deterministic bridge from the shipped player attack-window payload to target hit results.
 * Does not own attack state, target lifecycle, health, scene mutation, or a second combat framework.
 * @module gameplay/playerCombatHitResolver
 */

const EPSILON = 1e-6;

const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function normalizePoint(point) {
	return Object.freeze({ x: finite(point?.x), y: finite(point?.y), z: finite(point?.z) });
}

function normalizeFacing(facing) {
	const x = finite(facing?.x), z = finite(facing?.z);
	const length = Math.hypot(x, z);
	return length > EPSILON ? Object.freeze({ x: x / length, z: z / length }) : Object.freeze({ x: 0, z: 1 });
}

function distanceXZ(a, b) {
	return Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z));
}

function isTargetable(target) {
	return Boolean(target && target.id != null && target.position && target.hurtbox);
}

/**
 * Resolve one attack-window payload against caller-provided targets.
 * @param {object} input
 * @returns {ReadonlyArray<object>}
 */
export function resolvePlayerCombatHits({ attackWindow, targets = [], maxHits = 8 } = {}) {
	if (!attackWindow || attackWindow.active !== true) return Object.freeze([]);
	const origin = normalizePoint(attackWindow.position);
	const facing = normalizeFacing(attackWindow.facing);
	const reach = Math.max(0, finite(attackWindow.reachMeters));
	const damageScale = clamp(finite(attackWindow.damageScale, 1), 0, 10);
	const limit = Math.max(0, Math.min(32, Math.floor(finite(maxHits, 8))));
	const hits = [];
	const seen = new Set();
	for (const target of Array.isArray(targets) ? targets : []) {
		if (!isTargetable(target) || seen.has(target.id)) continue;
		const targetPoint = normalizePoint(target.position);
		const hurtbox = target.hurtbox;
		const targetRadius = clamp(finite(hurtbox.radius, 0.35), 0.05, 3);
		const targetHeight = clamp(finite(hurtbox.height, 1.8), 0.1, 4);
		const verticalOffset = Math.abs(targetPoint.y - origin.y);
		if (verticalOffset > targetHeight * 0.75) continue;
		const distance = distanceXZ(origin, targetPoint);
		if (distance > reach + targetRadius) continue;
		const directionX = targetPoint.x - origin.x;
		const directionZ = targetPoint.z - origin.z;
		const directionLength = Math.hypot(directionX, directionZ);
		const dot = directionLength > EPSILON ? (directionX * facing.x + directionZ * facing.z) / directionLength : 1;
		if (dot < -0.25) continue;
		hits.push(Object.freeze({
			targetId: String(target.id),
			distanceMeters: Number(distance.toFixed(4)),
			facingDot: Number(clamp(dot, -1, 1).toFixed(4)),
			appliedDamageScale: Number(damageScale.toFixed(4)),
			attackSerial: Math.max(0, Math.floor(finite(attackWindow.serial))),
			comboStep: Math.max(1, Math.floor(finite(attackWindow.comboStep, 1))),
		}));
		seen.add(target.id);
		if (hits.length >= limit) break;
	}
	hits.sort((a, b) => a.distanceMeters - b.distanceMeters || a.targetId.localeCompare(b.targetId));
	return Object.freeze(hits);
}
