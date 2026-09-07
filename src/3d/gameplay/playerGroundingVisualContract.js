/**
 * Visual grounding contract for player assets.
 *
 * This module is intentionally read-only with respect to world terrain. It measures the relationship
 * between the rendered character, authored foot anchors, the canonical ground sample and the gameplay
 * collider. It is useful at spawn and during combat so the visible feet, root transform and collision
 * plane cannot silently drift apart.
 *
 * It does not create terrain, alter ground height, or own physics. A terrain/physics owner supplies the
 * authoritative ground sample. The output is a compact deterministic record suitable for runtime HUD
 * diagnostics, browser proof and headless acceptance.
 *
 * @module gameplay/playerGroundingVisualContract
 */

const CONTRACT_VERSION = '2026-09-07-v1';
const DEFAULT_MAX_VISUAL_GROUND_DELTA = 0.12;
const DEFAULT_MAX_COLLIDER_GROUND_DELTA = 0.08;
const DEFAULT_MAX_FOOT_GROUND_DELTA = 0.10;
const DEFAULT_MAX_SLOPE_DEGREES = 55;
const FOOT_SOCKET_NAMES = Object.freeze({
	left: Object.freeze(['mixamorigLeftFoot', 'LeftFoot', 'leftFoot', 'foot_l', 'foot.L']),
	right: Object.freeze(['mixamorigRightFoot', 'RightFoot', 'rightFoot', 'foot_r', 'foot.R']),
});

function finite(value, fallback = null) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, finite(value, min)));
}

function rounded(value, digits = 4) {
	const factor = 10 ** digits;
	return Math.round(finite(value, 0) * factor) / factor;
}

function vector3(value, fallback = 0) {
	if (!value || typeof value !== 'object') return Object.freeze({ x: fallback, y: fallback, z: fallback });
	return Object.freeze({ x: finite(value.x, fallback), y: finite(value.y, fallback), z: finite(value.z, fallback) });
}

function distance2D(a, b) {
	return Math.hypot(finite(a?.x, 0) - finite(b?.x, 0), finite(a?.z, 0) - finite(b?.z, 0));
}

function distance3D(a, b) {
	return Math.hypot(
		finite(a?.x, 0) - finite(b?.x, 0),
		finite(a?.y, 0) - finite(b?.y, 0),
		finite(a?.z, 0) - finite(b?.z, 0),
	);
}

function walk(root, visitor) {
	if (!root) return;
	visitor(root);
	if (!Array.isArray(root.children)) return;
	for (const child of root.children) walk(child, visitor);
}

function findNamedNode(root, candidates) {
	const wanted = new Set(candidates.map((value) => String(value).toLowerCase()));
	let found = null;
	walk(root, (node) => {
		if (found) return;
		const name = String(node?.name || '').toLowerCase();
		if (wanted.has(name)) found = node;
	});
	return found;
}

function readWorldPosition(node) {
	if (!node) return null;
	if (node.matrixWorld?.elements && Array.isArray(node.matrixWorld.elements) === false) {
		const elements = node.matrixWorld.elements;
		if (elements.length >= 16) return Object.freeze({ x: finite(elements[12], 0), y: finite(elements[13], 0), z: finite(elements[14], 0) });
	}
	if (node.getWorldPosition && typeof node.getWorldPosition === 'function') {
		try {
			const target = { x: 0, y: 0, z: 0 };
			const result = node.getWorldPosition(target) || target;
			return vector3(result);
		} catch {
			return null;
		}
	}
	return vector3(node.position);
}

function materialList(root) {
	const materials = [];
	const seen = new Set();
	walk(root, (node) => {
		if (!node?.isMesh) return;
		const list = Array.isArray(node.material) ? node.material : [node.material];
		for (const material of list) {
			if (!material || seen.has(material)) continue;
			seen.add(material);
			materials.push(material);
		}
	});
	return materials;
}

function estimateVisualBounds(root) {
	let minimumY = Infinity;
	let maximumY = -Infinity;
	let minimumX = Infinity;
	let maximumX = -Infinity;
	let minimumZ = Infinity;
	let maximumZ = -Infinity;
	let meshCount = 0;
	walk(root, (node) => {
		if (!node?.isMesh) return;
		meshCount += 1;
		const box = node.geometry?.boundingBox;
		const position = readWorldPosition(node) || { x: 0, y: 0, z: 0 };
		if (box?.min && box?.max) {
			minimumX = Math.min(minimumX, position.x + finite(box.min.x, 0));
			maximumX = Math.max(maximumX, position.x + finite(box.max.x, 0));
			minimumY = Math.min(minimumY, position.y + finite(box.min.y, 0));
			maximumY = Math.max(maximumY, position.y + finite(box.max.y, 0));
			minimumZ = Math.min(minimumZ, position.z + finite(box.min.z, 0));
			maximumZ = Math.max(maximumZ, position.z + finite(box.max.z, 0));
			return;
		}
		minimumY = Math.min(minimumY, position.y);
		maximumY = Math.max(maximumY, position.y);
		minimumX = Math.min(minimumX, position.x);
		maximumX = Math.max(maximumX, position.x);
		minimumZ = Math.min(minimumZ, position.z);
		maximumZ = Math.max(maximumZ, position.z);
	});
	if (!Number.isFinite(minimumY)) return null;
	return Object.freeze({
		min: Object.freeze({ x: minimumX, y: minimumY, z: minimumZ }),
		max: Object.freeze({ x: maximumX, y: maximumY, z: maximumZ }),
		height: maximumY - minimumY,
		width: maximumX - minimumX,
		depth: maximumZ - minimumZ,
		meshCount,
	});
}

export function resolvePlayerFootAnchors(object3D) {
	const result = {};
	for (const [side, candidates] of Object.entries(FOOT_SOCKET_NAMES)) {
		const bone = findNamedNode(object3D, candidates);
		result[side] = Object.freeze({
			boneName: bone?.name || null,
			position: readWorldPosition(bone),
			available: Boolean(bone),
			candidates: [...candidates],
		});
	}
	return Object.freeze(result);
}

export function classifyGroundingStatus({ visualDelta, colliderDelta, footDeltas = [], maxVisualDelta = DEFAULT_MAX_VISUAL_GROUND_DELTA, maxColliderDelta = DEFAULT_MAX_COLLIDER_GROUND_DELTA, maxFootDelta = DEFAULT_MAX_FOOT_GROUND_DELTA } = {}) {
	const visual = Math.abs(finite(visualDelta, 999));
	const collider = Math.abs(finite(colliderDelta, 999));
	const feet = footDeltas.filter((value) => Number.isFinite(Number(value))).map((value) => Math.abs(Number(value)));
	const maxFoot = feet.length ? Math.max(...feet) : 0;
	if (visual > maxVisualDelta || collider > maxColliderDelta || maxFoot > maxFootDelta) return 'misaligned';
	if (visual > maxVisualDelta * 0.55 || collider > maxColliderDelta * 0.55 || maxFoot > maxFootDelta * 0.55) return 'near-limit';
	return 'grounded';
}

export function evaluatePlayerGrounding({
	object3D,
	groundSample,
	colliderGroundY = null,
	maxVisualDelta = DEFAULT_MAX_VISUAL_GROUND_DELTA,
	maxColliderDelta = DEFAULT_MAX_COLLIDER_GROUND_DELTA,
	maxFootDelta = DEFAULT_MAX_FOOT_GROUND_DELTA,
	maxSlopeDegrees = DEFAULT_MAX_SLOPE_DEGREES,
} = {}) {
	const errors = [];
	const rootY = finite(object3D?.position?.y, null);
	const groundY = finite(groundSample?.height ?? groundSample?.groundHeight ?? groundSample?.y, null);
	if (rootY === null) errors.push('player-root-y-missing');
	if (groundY === null) errors.push('ground-height-missing');
	const visualBounds = estimateVisualBounds(object3D);
	if (!visualBounds) errors.push('player-visual-bounds-missing');
	const visualGroundY = visualBounds?.min?.y ?? rootY;
	const visualDelta = rootY === null || groundY === null ? Infinity : Math.abs(visualGroundY - groundY);
	const colliderY = finite(colliderGroundY, groundY);
	const colliderDelta = rootY === null || colliderY === null ? Infinity : Math.abs(rootY - colliderY);
	const feet = resolvePlayerFootAnchors(object3D);
	const footDeltas = Object.values(feet).map((foot) => foot.position && groundY !== null ? Math.abs(foot.position.y - groundY) : null).filter((value) => value !== null);
	const slopeDegrees = finite(groundSample?.slopeDegrees ?? groundSample?.slope, null);
	if (slopeDegrees !== null && Math.abs(slopeDegrees) > maxSlopeDegrees) errors.push(`slope-out-of-contract:${rounded(slopeDegrees, 2)}`);
	if (visualDelta > maxVisualDelta) errors.push(`visual-ground-delta:${rounded(visualDelta, 4)}`);
	if (colliderDelta > maxColliderDelta) errors.push(`root-collider-delta:${rounded(colliderDelta, 4)}`);
	const maxFoot = footDeltas.length ? Math.max(...footDeltas) : 0;
	if (maxFoot > maxFootDelta) errors.push(`foot-ground-delta:${rounded(maxFoot, 4)}`);
	const status = classifyGroundingStatus({ visualDelta, colliderDelta, footDeltas, maxVisualDelta, maxColliderDelta, maxFootDelta });
	return Object.freeze({
		ok: errors.length === 0,
		status,
		contractVersion: CONTRACT_VERSION,
		rootY,
		groundY,
		colliderY,
		visualGroundY,
		visualDelta: rounded(visualDelta),
		colliderDelta: rounded(colliderDelta),
		footDeltas: Object.freeze(footDeltas.map((value) => rounded(value))),
		maxFootDelta: rounded(maxFoot),
		slopeDegrees: slopeDegrees === null ? null : rounded(slopeDegrees, 2),
		visualBounds,
		feet,
		errors: Object.freeze(errors),
	});
}

export function buildPlayerGroundingProof(input = {}) {
	const audit = evaluatePlayerGrounding(input);
	return Object.freeze({
		ok: audit.ok,
		status: audit.status,
		contractVersion: CONTRACT_VERSION,
		rootY: audit.rootY,
		groundY: audit.groundY,
		visualGroundY: audit.visualGroundY,
		visualDelta: audit.visualDelta,
		colliderDelta: audit.colliderDelta,
		maxFootDelta: audit.maxFootDelta,
		slopeDegrees: audit.slopeDegrees,
		meshCount: audit.visualBounds?.meshCount || 0,
		feetResolved: Object.values(audit.feet || {}).filter((foot) => foot.available).length,
		errors: Object.freeze([...audit.errors]),
	});
}

export function samplePlayerCombatFooting({ footAnchors, groundSampler, maxFootGroundDelta = DEFAULT_MAX_FOOT_GROUND_DELTA } = {}) {
	if (!footAnchors || !groundSampler || typeof groundSampler !== 'function') {
		return Object.freeze({ ok: false, error: 'foot-anchors-and-ground-sampler-required' });
	}
	const samples = [];
	for (const [side, anchor] of Object.entries(footAnchors)) {
		if (!anchor?.position) continue;
		let raw = null;
		try {
			raw = groundSampler(anchor.position.x, anchor.position.z);
		} catch (error) {
			samples.push(Object.freeze({ side, ok: false, error: error instanceof Error ? error.message : String(error) }));
			continue;
		}
		const groundY = finite(raw?.height ?? raw?.groundHeight ?? raw?.y ?? raw, null);
		const delta = groundY === null ? Infinity : Math.abs(anchor.position.y - groundY);
		samples.push(Object.freeze({ side, x: rounded(anchor.position.x, 3), y: rounded(anchor.position.y, 3), z: rounded(anchor.position.z, 3), groundY: groundY === null ? null : rounded(groundY, 3), delta: rounded(delta, 4), ok: Number.isFinite(delta) && delta <= maxFootGroundDelta }));
	}
	const errors = samples.filter((sample) => !sample.ok).map((sample) => `${sample.side}:${sample.error || `delta:${sample.delta}`}`);
	return Object.freeze({ ok: errors.length === 0, samples: Object.freeze(samples), errors: Object.freeze(errors), maxFootGroundDelta });
}

export function comparePlayerVisualAndColliderGround({ visualGroundY, colliderGroundY, tolerance = DEFAULT_MAX_COLLIDER_GROUND_DELTA } = {}) {
	const visual = finite(visualGroundY, null);
	const collider = finite(colliderGroundY, null);
	if (visual === null || collider === null) return Object.freeze({ ok: false, delta: null, error: 'ground-comparison-values-missing' });
	const delta = Math.abs(visual - collider);
	return Object.freeze({ ok: delta <= Math.max(0, Number(tolerance) || 0), delta: rounded(delta), tolerance: Math.max(0, Number(tolerance) || 0) });
}

export function resolvePlayerSlopeResponse({ slopeDegrees = 0, maxWalkSlopeDegrees = 32, maxCombatSlopeDegrees = 24 } = {}) {
	const slope = Math.abs(finite(slopeDegrees, 0));
	const walk = clamp(1 - Math.max(0, slope - maxWalkSlopeDegrees) / 15, 0, 1);
	const combat = clamp(1 - Math.max(0, slope - maxCombatSlopeDegrees) / 12, 0, 1);
	return Object.freeze({ slopeDegrees: rounded(slope, 2), walkGrip: rounded(walk), combatGrip: rounded(combat), walkAllowed: slope <= maxWalkSlopeDegrees, combatAllowed: slope <= maxCombatSlopeDegrees });
}

export function resolvePlayerFootPlantWeights({ leftDistance, rightDistance } = {}) {
	const left = Math.max(0, finite(leftDistance, 999));
	const right = Math.max(0, finite(rightDistance, 999));
	const total = left + right;
	if (!Number.isFinite(total) || total <= 0) return Object.freeze({ left: 0.5, right: 0.5 });
	const leftWeight = right / total;
	return Object.freeze({ left: rounded(clamp(leftWeight, 0, 1)), right: rounded(clamp(1 - leftWeight, 0, 1)) });
}

export function resolvePlayerRootCorrection({ rootY, targetGroundY, visualGroundOffset = 0, maxCorrectionMeters = 0.25 } = {}) {
	const current = finite(rootY, null);
	const target = finite(targetGroundY, null);
	if (current === null || target === null) return Object.freeze({ ok: false, correctionY: 0, error: 'root-correction-input-missing' });
	const desired = target - finite(visualGroundOffset, 0);
	const correctionY = clamp(desired - current, -Math.abs(maxCorrectionMeters), Math.abs(maxCorrectionMeters));
	return Object.freeze({ ok: true, correctionY: rounded(correctionY), desiredRootY: rounded(desired), clamped: Math.abs(desired - current) > Math.abs(correctionY) });
}

export function createPlayerGroundingContractSnapshot({ object3D, groundSample, colliderGroundY = null, worldX = null, worldZ = null } = {}) {
	const audit = evaluatePlayerGrounding({ object3D, groundSample, colliderGroundY });
	return Object.freeze({
		contractVersion: CONTRACT_VERSION,
		world: Object.freeze({ x: finite(worldX, object3D?.position?.x), z: finite(worldZ, object3D?.position?.z) }),
		status: audit.status,
		ok: audit.ok,
		ground: Object.freeze({ height: audit.groundY, slopeDegrees: audit.slopeDegrees, visualDelta: audit.visualDelta, colliderDelta: audit.colliderDelta, maxFootDelta: audit.maxFootDelta }),
		meshCount: audit.visualBounds?.meshCount || 0,
		feetResolved: Object.values(audit.feet || {}).filter((foot) => foot.available).length,
		errors: audit.errors,
	});
}
