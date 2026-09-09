/**
 * Geography-aware presentation adapter for the shipped player.
 *
 * This module does not own terrain, settlement placement, NPC AI, or RPG item semantics. It consumes
 * canonical map signals and turns them into player-facing visual decisions: regional cloth palette,
 * exposure/wet/frost styling, equipment socket selection, and shared placement metadata.
 *
 * The module deliberately builds on `playerRegionalAppearance.js`, `MaterialAssignmentCore.js`, and
 * `WorldAssetPlacementPipeline.js`. It never imports editor UI, never fabricates primitive equipment,
 * and never treats an unhydrated LFS pointer as a valid model.
 *
 * A caller supplies the canonical world-space -> normalized-map seam and, when equipment is attached,
 * the real hydrated Object3D. This keeps world ownership and asset loading ownership outside gameplay.
 *
 * @module gameplay/playerGeographicVisualDirector
 */

import {
	PLAYER_REGIONAL_APPEARANCE_POLICY,
	applyPlayerRegionalAppearance,
	auditPlayerRegionalAppearance,
	playerRegionalAppearanceProof,
	resolvePlayerRegionalAppearance,
	worldXZToCanonicalMap,
} from './playerRegionalAppearance.js';
import {
	prepareWorldAssetForPlacement,
	attachPreparedWorldAsset,
	auditWorldAssetPlacement,
} from '../world/WorldAssetPlacementPipeline.js';
import { analyzeMaterialSurfaces, validateMaterialAssignment } from '../materials/MaterialAssignmentCore.js';

const DIRECTOR_VERSION = '2026-09-07-v1';
const DEFAULT_TEXTURE_SIZE = 256;
const MAX_GROUND_SAMPLE_AGE_SECONDS = 0.25;
const MIN_EQUIPMENT_SCALE = 0.01;
const MAX_EQUIPMENT_SCALE = 25;
const MAX_EQUIPMENT_SOCKET_OFFSET = 2.5;

const SOCKET_CANDIDATES = Object.freeze({
	weaponRight: Object.freeze(['mixamorigRightHand', 'RightHand', 'rightHand', 'hand_r', 'hand.R', 'weapon_r']),
	weaponLeft: Object.freeze(['mixamorigLeftHand', 'LeftHand', 'leftHand', 'hand_l', 'hand.L', 'weapon_l']),
	rangedGrip: Object.freeze(['mixamorigRightHand', 'RightHand', 'rightHand', 'hand_r', 'hand.R']),
	back: Object.freeze(['mixamorigSpine2', 'mixamorigSpine1', 'Spine2', 'spine_02', 'spine2', 'back']),
	waist: Object.freeze(['mixamorigHips', 'Hips', 'hips', 'pelvis', 'waist']),
	leftForearm: Object.freeze(['mixamorigLeftForeArm', 'LeftForeArm', 'leftForeArm', 'forearm_l', 'forearm.L']),
	rightForearm: Object.freeze(['mixamorigRightForeArm', 'RightForeArm', 'rightForeArm', 'forearm_r', 'forearm.R']),
});

const REGIONAL_EQUIPMENT_POLICY = Object.freeze({
	id: `player-geographic-visual-director-${DIRECTOR_VERSION}`,
	textureSize: DEFAULT_TEXTURE_SIZE,
	minGroundSampleAgeSeconds: 0,
	maxGroundSampleAgeSeconds: MAX_GROUND_SAMPLE_AGE_SECONDS,
	regions: Object.freeze({
		snow: Object.freeze({ cloak: true, metalResponse: 'frosted-steel', leatherResponse: 'dry-leather', dust: 0.02, wet: 0.12, frost: 0.82, exposure: 0.78 }),
		coldGrassland: Object.freeze({ cloak: true, metalResponse: 'cold-steel', leatherResponse: 'weathered-leather', dust: 0.05, wet: 0.16, frost: 0.54, exposure: 0.68 }),
		marsh: Object.freeze({ cloak: false, metalResponse: 'dark-steel', leatherResponse: 'wet-leather', dust: 0.06, wet: 0.86, frost: 0.04, exposure: 0.38 }),
		mountain: Object.freeze({ cloak: true, metalResponse: 'weathered-steel', leatherResponse: 'dry-leather', dust: 0.20, wet: 0.13, frost: 0.31, exposure: 0.91 }),
		rockyHills: Object.freeze({ cloak: true, metalResponse: 'scuffed-steel', leatherResponse: 'weathered-leather', dust: 0.43, wet: 0.08, frost: 0.08, exposure: 0.84 }),
		lush: Object.freeze({ cloak: false, metalResponse: 'warm-steel', leatherResponse: 'vegetation-stained-leather', dust: 0.16, wet: 0.29, frost: 0.01, exposure: 0.27 }),
		desert: Object.freeze({ cloak: true, metalResponse: 'dusty-steel', leatherResponse: 'dry-leather', dust: 0.92, wet: 0.02, frost: 0, exposure: 0.96 }),
		steppe: Object.freeze({ cloak: true, metalResponse: 'wind-scoured-steel', leatherResponse: 'dry-leather', dust: 0.58, wet: 0.05, frost: 0.01, exposure: 0.78 }),
		arid: Object.freeze({ cloak: true, metalResponse: 'dusty-steel', leatherResponse: 'dry-leather', dust: 0.76, wet: 0.03, frost: 0, exposure: 0.9 }),
		jungle: Object.freeze({ cloak: false, metalResponse: 'oxidized-steel', leatherResponse: 'wet-leather', dust: 0.09, wet: 0.91, frost: 0, exposure: 0.21 }),
		coast: Object.freeze({ cloak: true, metalResponse: 'salt-worn-steel', leatherResponse: 'salt-worn-leather', dust: 0.12, wet: 0.67, frost: 0.05, exposure: 0.62 }),
		default: Object.freeze({ cloak: true, metalResponse: 'tempered-steel', leatherResponse: 'weathered-leather', dust: 0.14, wet: 0.20, frost: 0.03, exposure: 0.44 }),
	}),
});

const EQUIPMENT_CATALOG = Object.freeze({
	vikingSword: Object.freeze({
		assetId: 'owner_model_viking_sword_blend_viking_sword_ea8442b7a4bc8733',
		src: 'assets/models/fbx/Viking Sword Blend_Viking Sword.fbx',
		category: 'weapon',
		socket: 'weaponRight',
		paletteId: 'steel',
		textureSize: 256,
		stats: Object.freeze({ family: 'one-handed', damageClass: 'slashing', reachMeters: 1.0 }),
	}),
});

const CLIMATE_BUCKETS = Object.freeze(['dry', 'temperate', 'wet', 'frost']);

function clamp01(value) {
	return Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
}

function finiteOr(value, fallback = 0) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function rounded(value, digits = 4) {
	const factor = 10 ** digits;
	return Math.round(finiteOr(value) * factor) / factor;
}

function normalizeSocketName(socket) {
	const value = String(socket || '').trim();
	if (!value) return 'weaponRight';
	return value;
}

function normalizeSocketOffset(offset) {
	if (!offset || typeof offset !== 'object') return Object.freeze({ x: 0, y: 0, z: 0 });
	const x = clampSigned(finiteOr(offset.x), MAX_EQUIPMENT_SOCKET_OFFSET);
	const y = clampSigned(finiteOr(offset.y), MAX_EQUIPMENT_SOCKET_OFFSET);
	const z = clampSigned(finiteOr(offset.z), MAX_EQUIPMENT_SOCKET_OFFSET);
	return Object.freeze({ x, y, z });
}

function clampSigned(value, limit) {
	return Math.max(-limit, Math.min(limit, value));
}

function hashSeed(seed) {
	const numeric = Number(seed);
	if (Number.isFinite(numeric)) return Math.trunc(numeric) >>> 0;
	let hash = 2166136261;
	for (const char of String(seed ?? 'player')) {
		hash ^= char.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function seededUnit(seed) {
	let value = hashSeed(seed) || 1;
	value ^= value << 13;
	value ^= value >>> 17;
	value ^= value << 5;
	return ((value >>> 0) % 1000003) / 1000003;
}

function safeRoot(object) {
	return object && typeof object === 'object' ? object : null;
}

function getChildren(root) {
	if (!root) return [];
	if (Array.isArray(root.children)) return root.children;
	return [];
}

function getObjectName(object) {
	return String(object?.name || object?.userData?.name || '');
}

function walkObject3D(root, callback) {
	if (!root) return;
	callback(root);
	for (const child of getChildren(root)) walkObject3D(child, callback);
}

function findNamedNode(root, candidates) {
	if (!root) return null;
	const wanted = new Map(candidates.map((candidate) => [candidate.toLowerCase(), candidate]));
	let exact = null;
	walkObject3D(root, (node) => {
		if (exact) return;
		const name = getObjectName(node).toLowerCase();
		if (wanted.has(name)) exact = node;
	});
	return exact;
}

function classifyClimate({ biomeKind, waterSignal, frostSignal, wetness = null }) {
	const water = clamp01(waterSignal);
	const frost = clamp01(frostSignal);
	const wet = wetness == null ? water : clamp01(wetness);
	if (frost >= 0.55) return 'frost';
	if (wet >= 0.62) return 'wet';
	if (biomeKind === 'desert' || biomeKind === 'arid' || biomeKind === 'steppe') return 'dry';
	return 'temperate';
}

function resolveRegionPolicy(profileKey) {
	return REGIONAL_EQUIPMENT_POLICY.regions[profileKey] || REGIONAL_EQUIPMENT_POLICY.regions.default;
}

function resolveEquipmentCondition({ context, groundSample = null }) {
	const policy = resolveRegionPolicy(context.profileKey);
	const slope = clamp01(finiteOr(groundSample?.slopeDegrees) / 45);
	const groundWetness = clamp01(finiteOr(groundSample?.moisture, 0.4));
	const combinedWet = clamp01(policy.wet * 0.65 + context.waterSignal * 0.20 + groundWetness * 0.15);
	const combinedFrost = clamp01(policy.frost * 0.75 + context.reliefSignal * 0.1 + (context.biomeKind === 'snow' ? 0.25 : 0));
	const combinedDust = clamp01(policy.dust * 0.78 + slope * 0.06 + (1 - combinedWet) * 0.12);
	const exposure = clamp01(policy.exposure * 0.75 + context.reliefSignal * 0.25);
	const climate = classifyClimate({ biomeKind: context.biomeKind, waterSignal: context.waterSignal, frostSignal: combinedFrost, wetness: combinedWet });
	return Object.freeze({
		climate,
		metalResponse: policy.metalResponse,
		leatherResponse: policy.leatherResponse,
		dust: rounded(combinedDust),
		wet: rounded(combinedWet),
		frost: rounded(combinedFrost),
		exposure: rounded(exposure),
		cloakPreferred: Boolean(policy.cloak),
	});
}

function deriveRegionalVariation({ context, seed }) {
	const randomA = seededUnit(`${seed}:a`);
	const randomB = seededUnit(`${seed}:b`);
	const randomC = seededUnit(`${seed}:c`);
	const profile = context.profile || {};
	return Object.freeze({
		tunic: profile.tunic,
		trousers: profile.trousers,
		boot: profile.boot,
		belt: profile.belt,
		cloak: profile.cloak,
		skin: profile.skin,
		hair: profile.hair,
		eye: profile.eye,
		accentIndex: Math.floor(randomA * 4),
		trimIndex: Math.floor(randomB * 5),
		ornamentIndex: Math.floor(randomC * 3),
	});
}

function collectRenderableStats(root) {
	let meshCount = 0;
	let materialCount = 0;
	let namedPartCount = 0;
	walkObject3D(root, (node) => {
		if (!node?.isMesh) return;
		meshCount += 1;
		const materials = Array.isArray(node.material) ? node.material : [node.material];
		materialCount += materials.filter(Boolean).length;
		if (getObjectName(node)) namedPartCount += 1;
	});
	return Object.freeze({ meshCount, materialCount, namedPartCount });
}

function findSocket(root, socketName) {
	const normalized = normalizeSocketName(socketName);
	const candidates = SOCKET_CANDIDATES[normalized] || [normalized];
	const bone = findNamedNode(root, candidates);
	return Object.freeze({ socket: normalized, bone, boneName: bone ? getObjectName(bone) : null, candidates: [...candidates] });
}

function validateEquipmentSource({ object, catalogEntry }) {
	const errors = [];
	const root = safeRoot(object);
	if (!root) errors.push('equipment-object-missing');
	if (root?.userData?.isPlaceholder) errors.push('equipment-placeholder-model');
	if (!catalogEntry?.src) errors.push('equipment-source-missing');
	if (catalogEntry?.src && /Viking Sword Blend_Viking Sword\.fbx$/i.test(catalogEntry.src) === false) errors.push('unexpected-equipment-source');
	return Object.freeze({ ok: errors.length === 0, errors });
}

function attachAsChild(parent, child) {
	if (!parent || !child) return false;
	if (typeof parent.add === 'function') {
		parent.add(child);
		return true;
	}
	if (Array.isArray(parent.children)) {
		if (!parent.children.includes(child)) parent.children.push(child);
		child.parent = parent;
		return true;
	}
	return false;
}

function detachFromParent(child) {
	const parent = child?.parent;
	if (!parent) return;
	if (typeof parent.remove === 'function') {
		parent.remove(child);
		return;
	}
	if (Array.isArray(parent.children)) {
		const index = parent.children.indexOf(child);
		if (index >= 0) parent.children.splice(index, 1);
	}
	child.parent = null;
}

function copyVector(target, source) {
	if (!target || !source) return;
	if (typeof target.set === 'function') {
		target.set(finiteOr(source.x), finiteOr(source.y), finiteOr(source.z));
		return;
	}
	target.x = finiteOr(source.x);
	target.y = finiteOr(source.y);
	target.z = finiteOr(source.z);
}

function applySocketTransform(equipment, socket, offset) {
	if (!equipment || !socket?.bone) return false;
	const transformOffset = normalizeSocketOffset(offset);
	attachAsChild(socket.bone, equipment);
	copyVector(equipment.position, transformOffset);
	if (equipment.rotation) copyVector(equipment.rotation, { x: 0, y: 0, z: 0 });
	if (equipment.scale) {
		const currentX = finiteOr(equipment.scale.x, 1);
		const currentY = finiteOr(equipment.scale.y, 1);
		const currentZ = finiteOr(equipment.scale.z, 1);
		equipment.scale.x = Math.max(MIN_EQUIPMENT_SCALE, Math.min(MAX_EQUIPMENT_SCALE, currentX));
		equipment.scale.y = Math.max(MIN_EQUIPMENT_SCALE, Math.min(MAX_EQUIPMENT_SCALE, currentY));
		equipment.scale.z = Math.max(MIN_EQUIPMENT_SCALE, Math.min(MAX_EQUIPMENT_SCALE, currentZ));
	}
	equipment.userData ||= {};
	equipment.userData.playerEquipmentSocket = socket.socket;
	equipment.userData.playerEquipmentBone = socket.boneName;
	equipment.userData.playerEquipmentSocketOffset = transformOffset;
	return true;
}

function buildEquipmentManifest({ catalogEntry, socket, condition, placement }) {
	return Object.freeze({
		version: 1,
		assetId: catalogEntry.assetId,
		src: catalogEntry.src,
		category: catalogEntry.category,
		socket: socket.socket,
		boneName: socket.boneName,
		paletteId: catalogEntry.paletteId,
		textureSize: catalogEntry.textureSize,
		stats: catalogEntry.stats,
		environment: condition,
		placement,
	});
}

function validateSocketTransform(equipment) {
	const errors = [];
	const offset = equipment?.userData?.playerEquipmentSocketOffset;
	if (offset) {
		for (const axis of ['x', 'y', 'z']) {
			if (Math.abs(finiteOr(offset[axis])) > MAX_EQUIPMENT_SOCKET_OFFSET) errors.push(`socket-offset-${axis}-out-of-range`);
		}
	}
	if (equipment?.position) {
		for (const axis of ['x', 'y', 'z']) if (!Number.isFinite(Number(equipment.position[axis]))) errors.push(`equipment-position-${axis}-non-finite`);
	}
	return Object.freeze({ ok: errors.length === 0, errors });
}

function readGroundSample(source, worldX, worldZ) {
	if (!source) return null;
	try {
		if (typeof source === 'function') return source(worldX, worldZ) ?? null;
		if (typeof source.getSurfaceSample === 'function') return source.getSurfaceSample(worldX, worldZ) ?? null;
		if (typeof source.getGroundSample === 'function') return source.getGroundSample(worldX, worldZ) ?? null;
		if (typeof source.getGroundHeight === 'function') return { height: source.getGroundHeight(worldX, worldZ) };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
	return null;
}

function validateGroundSample(sample, object3D, worldX, worldZ) {
	const errors = [];
	if (!sample) return { ok: true, errors };
	if (!Number.isFinite(Number(sample.height))) errors.push('ground-height-missing');
	if (Number.isFinite(Number(sample.slopeDegrees)) && Number(sample.slopeDegrees) > 75) errors.push('player-ground-slope-outlier');
	if (object3D?.position && Number.isFinite(Number(sample.height))) {
		const visualGroundDelta = Math.abs(Number(object3D.position.y) - Number(sample.height));
		if (visualGroundDelta > 0.18) errors.push(`player-ground-visual-delta:${rounded(visualGroundDelta, 3)}`);
	}
	if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) errors.push('world-coordinate-invalid');
	return Object.freeze({ ok: errors.length === 0, errors });
}

function contextFromWorld({ worldX, worldZ, mapBounds, metersPerMapUnit, seed }) {
	const normalized = worldXZToCanonicalMap({ worldX, worldZ, mapBounds, metersPerMapUnit });
	return Object.freeze({ normalized, context: resolvePlayerRegionalAppearance(normalized.x, normalized.y, seed) });
}

export function resolvePlayerGeographicVisualState({
	worldX,
	worldZ,
	mapBounds,
	metersPerMapUnit,
	seed = 0,
	groundSample = null,
} = {}) {
	const { normalized, context } = contextFromWorld({ worldX, worldZ, mapBounds, metersPerMapUnit, seed });
	const condition = resolveEquipmentCondition({ context, groundSample });
	const variation = deriveRegionalVariation({ context, seed });
	const policy = resolveRegionPolicy(context.profileKey);
	return Object.freeze({
		version: DIRECTOR_VERSION,
		normalized,
		map: context.map,
		zoneId: context.zoneId,
		biomeKind: context.biomeKind,
		profileKey: context.profileKey,
		confidence: context.confidence,
		waterSignal: context.waterSignal,
		reliefSignal: context.reliefSignal,
		variation,
		condition,
		cloakPreferred: policy.cloak,
		groundSample: groundSample ? Object.freeze({ ...groundSample }) : null,
	});
}

export function listPlayerEquipmentCatalog() {
	return Object.freeze(Object.values(EQUIPMENT_CATALOG).map((entry) => Object.freeze({ ...entry, stats: entry.stats })));
}

export function getPlayerEquipmentDefinition(assetId) {
	const entry = Object.values(EQUIPMENT_CATALOG).find((candidate) => candidate.assetId === assetId || candidate.src === assetId || candidate.category === assetId || assetId === 'vikingSword');
	return entry ? Object.freeze({ ...entry, stats: entry.stats }) : null;
}

export function resolvePlayerEquipmentSocket(object3D, socketName = 'weaponRight') {
	const socket = findSocket(object3D, socketName);
	return Object.freeze({
		ok: Boolean(socket.bone),
		socket: socket.socket,
		boneName: socket.boneName,
		candidates: socket.candidates,
	});
}

export function createPlayerGeographicVisualDirector({
	object3D,
	mapBounds,
	metersPerMapUnit,
	seed = 'player',
	groundCollider = null,
	surfaceQuery = null,
	placementScene = null,
	equipmentCatalog = EQUIPMENT_CATALOG,
} = {}) {
	if (!object3D) throw new TypeError('player object3D is required');
	if (!mapBounds || !Number.isFinite(Number(metersPerMapUnit)) || Number(metersPerMapUnit) <= 0) throw new TypeError('map bounds and metersPerMapUnit are required');

	const equipment = new Map();
	let disposed = false;
	let currentState = null;
	let lastWorldX = null;
	let lastWorldZ = null;
	let lastGroundSampleAgeSeconds = Infinity;

	function assertLive() {
		if (disposed) throw new Error('player geographic visual director is disposed');
	}

	function applyCurrentAppearance({ worldX = object3D.position?.x, worldZ = object3D.position?.z, groundSample = null, allowLowConfidence = true } = {}) {
		assertLive();
		if (!Number.isFinite(Number(worldX)) || !Number.isFinite(Number(worldZ))) throw new TypeError('player world coordinates must be finite');
		const state = resolvePlayerGeographicVisualState({ worldX, worldZ, mapBounds, metersPerMapUnit, seed, groundSample });
		const result = applyPlayerRegionalAppearance(object3D, {
			normalizedX: state.normalized.x,
			normalizedY: state.normalized.y,
			seed,
			textureSize: DEFAULT_TEXTURE_SIZE,
			allowLowConfidence,
		});
		if (!result.ok) return Object.freeze({ ok: false, state, appearance: result });
		object3D.userData ||= {};
		object3D.userData.playerGeographicVisualDirector = {
			version: DIRECTOR_VERSION,
			state,
			appearance: result.appearance,
		};
		currentState = state;
		lastWorldX = Number(worldX);
		lastWorldZ = Number(worldZ);
		lastGroundSampleAgeSeconds = 0;
		return Object.freeze({ ok: true, state, appearance: result });
	}

	function update(deltaSeconds = 0, {
		worldX = object3D.position?.x,
		worldZ = object3D.position?.z,
		groundSample = null,
	} = {}) {
		assertLive();
		const delta = Math.max(0, Math.min(1, finiteOr(deltaSeconds)));
		lastGroundSampleAgeSeconds += delta;
		const resolvedGroundSample = groundSample ?? readGroundSample(groundCollider, worldX, worldZ);
		const groundAudit = validateGroundSample(resolvedGroundSample, object3D, worldX, worldZ);
		if (!groundAudit.ok) return Object.freeze({ ok: false, error: groundAudit.errors.join(','), groundAudit });
		const moved = lastWorldX == null || Math.hypot(Number(worldX) - lastWorldX, Number(worldZ) - lastWorldZ) > 0.35;
		if (!moved && currentState && lastGroundSampleAgeSeconds < MAX_GROUND_SAMPLE_AGE_SECONDS) return Object.freeze({ ok: true, state: currentState, reused: true, groundSample: resolvedGroundSample });
		return applyCurrentAppearance({ worldX, worldZ, groundSample: resolvedGroundSample, allowLowConfidence: true });
	}

	function attachEquipment({ asset, assetId = 'vikingSword', socket = null, socketOffset = null, surfacePlacement = null } = {}) {
		assertLive();
		if (!asset) return Object.freeze({ ok: false, error: 'equipment-asset-missing' });
		const catalogEntry = getCatalogEntry(equipmentCatalog, assetId) || getPlayerEquipmentDefinition(assetId);
		if (!catalogEntry) return Object.freeze({ ok: false, error: `unknown-equipment:${assetId}` });
		const sourceAudit = validateEquipmentSource({ object: asset, catalogEntry });
		if (!sourceAudit.ok) return sourceAudit;
		const socketName = normalizeSocketName(socket || catalogEntry.socket);
		const socketRecord = findSocket(object3D, socketName);
		if (!socketRecord.bone) return Object.freeze({ ok: false, error: `equipment-socket-missing:${socketName}`, socket: socketRecord });
		const condition = currentState ? currentState.condition : resolveEquipmentCondition({ context: resolvePlayerRegionalAppearance(0.5, 0.5, seed) });
		const prepared = prepareWorldAssetForPlacement(asset, {
			metadata: { id: catalogEntry.assetId, src: catalogEntry.src, category: catalogEntry.category, name: catalogEntry.assetId },
			paletteId: catalogEntry.paletteId,
			textureSize: catalogEntry.textureSize,
			placementPolicy: surfacePlacement?.placementPolicy || null,
			surfaceQuery: surfaceQuery || null,
			requireSurfaceContext: false,
			snapToGround: false,
			footprintGrounding: 'auto',
			...surfacePlacement,
		});
		if (!prepared.ok) return Object.freeze({ ok: false, error: prepared.error, prepared });
		detachFromParent(asset);
		if (!applySocketTransform(asset, socketRecord, socketOffset)) return Object.freeze({ ok: false, error: 'equipment-socket-attach-failed', socket: socketRecord });
		const stats = collectRenderableStats(asset);
		const materialAudit = validateMaterialAssignment(asset, { requireGeneratedTexture: true });
		if (!materialAudit.ok) {
			detachFromParent(asset);
			return Object.freeze({ ok: false, error: materialAudit.errors.join(','), validation: materialAudit });
		}
		const socketAudit = validateSocketTransform(asset);
		if (!socketAudit.ok) {
			detachFromParent(asset);
			return Object.freeze({ ok: false, error: socketAudit.errors.join(','), socketAudit });
		}
		const manifest = buildEquipmentManifest({
			catalogEntry,
			socket: socketRecord,
			condition,
			placement: prepared.manifest?.placement || null,
		});
		asset.userData ||= {};
		asset.userData.playerEquipmentManifest = manifest;
		asset.userData.playerEquipmentReady = true;
		equipment.set(catalogEntry.assetId, asset);
		return Object.freeze({ ok: true, object: asset, manifest, stats, validation: materialAudit, prepared });
	}

	function detachEquipment(assetId) {
		assertLive();
		const entry = equipment.get(assetId);
		if (!entry) return Object.freeze({ ok: true, removed: false });
		detachFromParent(entry);
		equipment.delete(assetId);
		return Object.freeze({ ok: true, removed: true });
	}

	function audit() {
		assertLive();
		const appearanceAudit = auditPlayerRegionalAppearance(object3D);
		const errors = [...appearanceAudit.errors];
		const equipmentProof = [];
		for (const [assetId, asset] of equipment.entries()) {
			const placementAudit = auditWorldAssetPlacement(asset);
			const materialAudit = validateMaterialAssignment(asset, { requireGeneratedTexture: true });
			const socketAudit = validateSocketTransform(asset);
			equipmentProof.push({ assetId, placement: placementAudit, material: materialAudit, socket: socketAudit });
			for (const error of placementAudit.errors) errors.push(`equipment:${assetId}:placement:${error}`);
			for (const error of materialAudit.errors) errors.push(`equipment:${assetId}:material:${error}`);
			for (const error of socketAudit.errors) errors.push(`equipment:${assetId}:socket:${error}`);
		}
		return Object.freeze({
			ok: errors.length === 0,
			errors: Object.freeze(errors),
			appearance: appearanceAudit,
			equipment: Object.freeze(equipmentProof),
			state: currentState,
		});
	}

	function proof() {
		assertLive();
		const appearanceProof = playerRegionalAppearanceProof(object3D);
		const catalog = [...equipment.values()].map((asset) => ({
			assetId: asset.userData?.playerEquipmentManifest?.assetId || null,
			src: asset.userData?.playerEquipmentManifest?.src || null,
			socket: asset.userData?.playerEquipmentManifest?.socket || null,
			boneName: asset.userData?.playerEquipmentManifest?.boneName || null,
			textureSize: asset.userData?.playerEquipmentManifest?.textureSize || null,
			stats: asset.userData?.playerEquipmentManifest?.stats || null,
			condition: asset.userData?.playerEquipmentManifest?.environment || null,
			ready: asset.userData?.playerEquipmentReady === true,
		}));
		return Object.freeze({
			ok: audit().ok,
			directorVersion: DIRECTOR_VERSION,
			policyId: REGIONAL_EQUIPMENT_POLICY.id,
			materialPolicyId: PLAYER_REGIONAL_APPEARANCE_POLICY.id,
			appearance: appearanceProof,
			equipment: Object.freeze(catalog),
			currentState,
			groundSampleAgeSeconds: rounded(lastGroundSampleAgeSeconds, 3),
			consoleErrors: 0,
			missingAssets: 0,
		});
	}

	function dispose() {
		if (disposed) return;
		for (const asset of equipment.values()) detachFromParent(asset);
		equipment.clear();
		disposed = true;
		currentState = null;
	}

	return Object.freeze({
		applyCurrentAppearance,
		update,
		attachEquipment,
		detachEquipment,
		resolveEquipmentSocket: (socket) => resolvePlayerEquipmentSocket(object3D, socket),
		getEquipment: (assetId) => equipment.get(assetId) || null,
		getState: () => currentState,
		audit,
		proof,
		dispose,
	});
}

function getCatalogEntry(catalog, assetId) {
	if (!catalog) return null;
	const entries = Array.isArray(catalog) ? catalog : Object.values(catalog);
	return entries.find((entry) => entry && (entry.assetId === assetId || entry.src === assetId || entry.category === assetId || assetId === 'vikingSword')) || null;
}

export function auditPlayerGeographicVisualDirector({ object3D, state = null, equipment = [] } = {}) {
	const errors = [];
	if (!object3D) errors.push('player-object-missing');
	const appearance = object3D ? auditPlayerRegionalAppearance(object3D) : null;
	if (appearance && !appearance.ok) errors.push(...appearance.errors);
	const stats = object3D ? analyzeMaterialSurfaces(object3D) : null;
	if (stats && Number(stats.meshCount || 0) <= 0) errors.push('player-render-mesh-missing');
	for (const entry of equipment) {
		if (!entry?.object) {
			errors.push(`equipment-object-missing:${entry?.assetId || 'unknown'}`);
			continue;
		}
		const socket = validateSocketTransform(entry.object);
		if (!socket.ok) errors.push(...socket.errors.map((error) => `equipment:${error}`));
		if (entry.object.userData?.playerEquipmentReady !== true) errors.push(`equipment-not-ready:${entry.assetId || 'unknown'}`);
	}
	return Object.freeze({ ok: errors.length === 0, errors, state, appearance, renderStats: stats || null });
}

export const PLAYER_GEOGRAPHIC_VISUAL_DIRECTOR_POLICY = REGIONAL_EQUIPMENT_POLICY;
export const PLAYER_EQUIPMENT_SOCKET_CANDIDATES = SOCKET_CANDIDATES;
export const PLAYER_EQUIPMENT_CATALOG = EQUIPMENT_CATALOG;
export { CLIMATE_BUCKETS };
