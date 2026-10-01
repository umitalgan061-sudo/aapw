/**
 * Asset-role contract for functional settlement content.
 *
 * This is metadata only. It does not load GLBs, create materials, or place objects.
 * Runtime consumers should pass the selected asset through MaterialAssignmentCore and
 * WorldAssetPlacementPipeline after resolving the role here.
 *
 * The role definitions deliberately separate visual identity from functional binding:
 * a file name may suggest a blacksmith, but the runtime must still verify its material,
 * surface and placement evidence before scene attachment.
 */

export const SETTLEMENT_ASSET_ROLE_POLICY_ID = 'settlement-asset-role-policy-v1-2026-09-07';

const ROOTS = Object.freeze({
	settlements: 'assets/models/settlements/',
	houses: 'assets/models/houses/',
	props: 'assets/models/props/',
	fbx: 'assets/models/fbx/',
});

function freezeArray(values) {
	return Object.freeze([...(Array.isArray(values) ? values : [])]);
}

function freezeRole(role) {
	return Object.freeze({
		...role,
		approvedRoots: freezeArray(role.approvedRoots),
		filenameTokens: freezeArray(role.filenameTokens),
		preferredMaterialRoles: Object.freeze({ ...(role.preferredMaterialRoles || {}) }),
		functionalServices: freezeArray(role.functionalServices),
		placementConstraints: Object.freeze({ ...(role.placementConstraints || {}) }),
	});
}

export const SETTLEMENT_ASSET_ROLE_POLICY = Object.freeze({
	id: SETTLEMENT_ASSET_ROLE_POLICY_ID,
	approvedRoots: Object.freeze({ ...ROOTS }),
	roles: Object.freeze({
		residential: freezeRole({
			id: 'residential',
			label: 'Residential house / cabin',
			approvedRoots: [ROOTS.settlements, ROOTS.houses],
			filenameTokens: ['house', 'cabin', 'hut', 'home', 'longhouse'],
			preferredMaterialRoles: { wall: ['plaster', 'house', 'brick', 'stone'], roof: ['thatch', 'roof-tile'], timber: ['wood'], trim: ['stone', 'rock'] },
			functionalServices: [],
			placementConstraints: {
				maxSlopeDegrees: 12,
				maxWaterDepthMeters: 0.02,
				preferredRoadDistanceMeters: 18,
				maximumRoadDistanceMeters: 82,
				allowInnerSettlement: true,
				allowSettlementFringe: true,
			},
		}),
		market: freezeRole({
			id: 'market',
			label: 'Market / vendor frontage',
			approvedRoots: [ROOTS.settlements, ROOTS.props],
			filenameTokens: ['market', 'stall', 'shop', 'stand', 'vendor'],
			preferredMaterialRoles: { wall: ['house', 'plaster', 'wood'], roof: ['thatch', 'roof-tile'], timber: ['wood'], trim: ['stone', 'iron'] },
			functionalServices: ['trade', 'market-trade'],
			placementConstraints: {
				maxSlopeDegrees: 12,
				maxWaterDepthMeters: 0.02,
				preferredRoadDistanceMeters: 14,
				maximumRoadDistanceMeters: 32,
				minimumSettlementRadiusMeters: 4,
				maximumSettlementRadiusMeters: 24,
				requireCanonicalRoad: true,
			},
		}),
		tavern: freezeRole({
			id: 'tavern',
			label: 'Tavern / inn',
			approvedRoots: [ROOTS.settlements, ROOTS.houses],
			filenameTokens: ['tavern', 'inn', 'pub'],
			preferredMaterialRoles: { wall: ['house', 'plaster', 'wood'], roof: ['thatch', 'roof-tile'], timber: ['wood'], trim: ['stone'] },
			functionalServices: ['rest', 'tavern-rest'],
			placementConstraints: {
				maxSlopeDegrees: 12,
				maxWaterDepthMeters: 0.02,
				preferredRoadDistanceMeters: 16,
				maximumRoadDistanceMeters: 34,
				minimumSettlementRadiusMeters: 6,
				maximumSettlementRadiusMeters: 30,
				requireCanonicalRoad: true,
			},
		}),
		blacksmith: freezeRole({
			id: 'blacksmith',
			label: 'Blacksmith / forge',
			approvedRoots: [ROOTS.settlements, ROOTS.props],
			filenameTokens: ['blacksmith', 'forge', 'smith'],
			preferredMaterialRoles: { wall: ['brick', 'stone', 'rock'], roof: ['roof-tile', 'thatch'], timber: ['wood'], trim: ['iron', 'stone'] },
			functionalServices: ['craft', 'smithing'],
			placementConstraints: {
				maxSlopeDegrees: 12,
				maxWaterDepthMeters: 0.02,
				preferredRoadDistanceMeters: 21,
				maximumRoadDistanceMeters: 38,
				minimumSettlementRadiusMeters: 10,
				maximumSettlementRadiusMeters: 34,
				requireCanonicalRoad: true,
			},
		}),
		stable: freezeRole({
			id: 'stable',
			label: 'Stable / horse yard',
			approvedRoots: [ROOTS.settlements, ROOTS.props],
			filenameTokens: ['stable', 'stables', 'horse', 'barn'],
			preferredMaterialRoles: { wall: ['wood', 'plaster', 'brick'], roof: ['thatch', 'roof-tile'], timber: ['wood'], trim: ['iron', 'stone'] },
			functionalServices: ['travel', 'stable-travel'],
			placementConstraints: {
				maxSlopeDegrees: 10,
				maxWaterDepthMeters: 0.02,
				preferredRoadDistanceMeters: 26,
				maximumRoadDistanceMeters: 48,
				minimumSettlementRadiusMeters: 24,
				maximumSettlementRadiusMeters: 48,
				requireCanonicalRoad: true,
			},
		}),
		farm: freezeRole({
			id: 'farm',
			label: 'Farm / cultivated field',
			approvedRoots: [ROOTS.settlements, ROOTS.props],
			filenameTokens: ['farm', 'field', 'crop', 'garden'],
			preferredMaterialRoles: { wall: ['wood', 'house', 'plaster'], roof: ['thatch'], timber: ['wood'], trim: ['stone'] },
			functionalServices: ['provision', 'farm-provisioning'],
			placementConstraints: {
				maxSlopeDegrees: 9,
				maxWaterDepthMeters: 0.02,
				preferredRoadDistanceMeters: 30,
				maximumRoadDistanceMeters: 72,
				minimumSettlementRadiusMeters: 34,
				requireSoilAccess: true,
				preferredWaterAccessMeters: 90,
				maximumWaterAccessMeters: 240,
			},
		}),
		barn: freezeRole({
			id: 'barn',
			label: 'Barn / agricultural storage',
			approvedRoots: [ROOTS.settlements, ROOTS.props],
			filenameTokens: ['barn', 'shed', 'storehouse', 'granary'],
			preferredMaterialRoles: { wall: ['wood', 'plaster', 'brick'], roof: ['thatch', 'roof-tile'], timber: ['wood'], trim: ['iron', 'stone'] },
			functionalServices: ['storage', 'farm-storage'],
			placementConstraints: {
				maxSlopeDegrees: 9,
				maxWaterDepthMeters: 0.02,
				preferredRoadDistanceMeters: 34,
				maximumRoadDistanceMeters: 76,
				minimumSettlementRadiusMeters: 31,
				requireSoilAccess: true,
			},
		}),
		barracks: freezeRole({
			id: 'barracks',
			label: 'Barracks / garrison',
			approvedRoots: [ROOTS.settlements],
			filenameTokens: ['barracks', 'garrison', 'guard'],
			preferredMaterialRoles: { wall: ['stone', 'brick', 'rock'], roof: ['roof-tile', 'thatch'], timber: ['wood'], trim: ['iron', 'stone'] },
			functionalServices: ['quest', 'barracks-quest'],
			placementConstraints: {
				maxSlopeDegrees: 12,
				maxWaterDepthMeters: 0.02,
				preferredRoadDistanceMeters: 24,
				maximumRoadDistanceMeters: 70,
				minimumSettlementRadiusMeters: 14,
				preferredSettlementRadiusMeters: 32,
				requireVisiblePosition: true,
			},
		}),
		entry: freezeRole({
			id: 'entry',
			label: 'Door / gate / threshold prop',
			approvedRoots: [ROOTS.settlements, ROOTS.props],
			filenameTokens: ['door', 'gate', 'entrance', 'threshold'],
			preferredMaterialRoles: { wall: ['stone', 'wood', 'brick'], roof: [], timber: ['wood'], trim: ['iron', 'stone'] },
			functionalServices: ['enter'],
			placementConstraints: {
				maxSlopeDegrees: 12,
				maxWaterDepthMeters: 0.02,
				requireBuildingParent: true,
			},
		}),
		storage: freezeRole({
			id: 'storage',
			label: 'Chest / crate / barrel storage prop',
			approvedRoots: [ROOTS.props, ROOTS.settlements],
			filenameTokens: ['chest', 'crate', 'barrel', 'storage'],
			preferredMaterialRoles: { wall: ['wood', 'iron'], roof: [], timber: ['wood'], trim: ['iron'] },
			functionalServices: ['storage'],
			placementConstraints: {
				maxSlopeDegrees: 14,
				maxWaterDepthMeters: 0.02,
				requireBuildingParent: false,
			},
		}),
	}),
});

export const SETTLEMENT_ASSET_ROLES = Object.freeze(Object.keys(SETTLEMENT_ASSET_ROLE_POLICY.roles));

export function getSettlementAssetRole(roleId) {
	return SETTLEMENT_ASSET_ROLE_POLICY.roles[roleId] || null;
}

export function inferSettlementAssetRoleFromPath(assetPath) {
	if (typeof assetPath !== 'string' || assetPath.trim() === '') return null;
	const path = assetPath.toLowerCase();
	for (const roleId of SETTLEMENT_ASSET_ROLES) {
		const role = getSettlementAssetRole(roleId);
		if (role.filenameTokens.some((token) => path.includes(token))) return roleId;
	}
	return null;
}

export function isSettlementAssetPathApprovedForRole(roleId, assetPath) {
	const role = getSettlementAssetRole(roleId);
	if (!role || typeof assetPath !== 'string') return false;
	return role.approvedRoots.some((root) => assetPath.startsWith(root)) && !/(?:placeholder|dummy|test_asset|prototype)/i.test(assetPath);
}

function materialRoleIncludes(role, requested) {
	return Array.isArray(role?.preferredMaterialRoles?.[requested]) && role.preferredMaterialRoles[requested].length > 0;
}

export function evaluateSettlementAssetRoleCompatibility(roleId, {
	assetPath = '',
	materialRoles = {},
	slopeDegrees = 0,
	waterDepth = 0,
	roadDistanceMeters = 1_000_000,
	radiusMeters = 0,
	soilAccessScore = 0,
	waterDistanceMeters = 1_000_000,
	visible = true,
	hasBuildingParent = true,
} = {}) {
	const role = getSettlementAssetRole(roleId);
	if (!role) return Object.freeze({ ok: false, reason: 'unknown-role', score: 0 });
	if (!isSettlementAssetPathApprovedForRole(roleId, assetPath)) return Object.freeze({ ok: false, reason: 'asset-path-not-approved', score: 0 });
	const constraints = role.placementConstraints;
	if (Math.abs(slopeDegrees) > constraints.maxSlopeDegrees) return Object.freeze({ ok: false, reason: 'slope-too-steep', score: 0 });
	if (Math.max(0, waterDepth) > constraints.maxWaterDepthMeters) return Object.freeze({ ok: false, reason: 'water-depth-too-high', score: 0 });
	if (Number.isFinite(constraints.minimumSettlementRadiusMeters) && radiusMeters < constraints.minimumSettlementRadiusMeters) {
		return Object.freeze({ ok: false, reason: 'too-close-to-settlement-center', score: 0 });
	}
	if (Number.isFinite(constraints.maximumSettlementRadiusMeters) && radiusMeters > constraints.maximumSettlementRadiusMeters) {
		return Object.freeze({ ok: false, reason: 'outside-settlement-service-radius', score: 0 });
	}
	if (Number.isFinite(constraints.preferredSettlementRadiusMeters) && radiusMeters > constraints.preferredSettlementRadiusMeters + 24) {
		return Object.freeze({ ok: false, reason: 'too-far-from-preferred-settlement-ring', score: 0 });
	}
	if (Number.isFinite(constraints.maximumRoadDistanceMeters) && roadDistanceMeters > constraints.maximumRoadDistanceMeters) {
		return Object.freeze({ ok: false, reason: 'too-far-from-road', score: 0 });
	}
	if (constraints.requireCanonicalRoad && !Number.isFinite(roadDistanceMeters)) return Object.freeze({ ok: false, reason: 'canonical-road-missing', score: 0 });
	if (constraints.requireSoilAccess && soilAccessScore < 0.45) return Object.freeze({ ok: false, reason: 'soil-access-too-low', score: 0 });
	if (Number.isFinite(constraints.maximumWaterAccessMeters) && waterDistanceMeters > constraints.maximumWaterAccessMeters) {
		return Object.freeze({ ok: false, reason: 'farm-water-access-too-distant', score: 0 });
	}
	if (constraints.requireVisiblePosition && !visible) return Object.freeze({ ok: false, reason: 'visibility-required', score: 0 });
	if (constraints.requireBuildingParent && !hasBuildingParent) return Object.freeze({ ok: false, reason: 'building-parent-required', score: 0 });

	const materialEvidence = Object.keys(role.preferredMaterialRoles).reduce((count, materialRole) => {
		const value = materialRoles[materialRole];
		return count + (value && materialRoleIncludes(role, materialRole) && role.preferredMaterialRoles[materialRole].includes(value) ? 1 : 0);
	}, 0);
	const materialSlotCount = Object.keys(role.preferredMaterialRoles).filter((key) => role.preferredMaterialRoles[key].length > 0).length;
	const materialScore = materialSlotCount === 0 ? 0.5 : materialEvidence / materialSlotCount;
	const roadScore = Number.isFinite(constraints.preferredRoadDistanceMeters)
		? Math.exp(-Math.pow((roadDistanceMeters - constraints.preferredRoadDistanceMeters) / Math.max(8, constraints.preferredRoadDistanceMeters * 0.8), 2))
		: 0.5;
	const slopeScore = clamp01(1 - Math.abs(slopeDegrees) / Math.max(0.01, constraints.maxSlopeDegrees));
	const visibilityScore = visible ? 1 : 0;
	const score = clamp01(materialScore * 0.4 + roadScore * 0.28 + slopeScore * 0.2 + visibilityScore * 0.12);
	return Object.freeze({
		ok: score > 0,
		reason: score > 0 ? null : 'insufficient-evidence',
		score,
		materialEvidence,
		materialSlotCount,
		roadScore,
		slopeScore,
		visibilityScore,
	});
}

function clamp01(value) {
	return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function isSettlementAssetRolePolicySane() {
	const roles = SETTLEMENT_ASSET_ROLES.map(getSettlementAssetRole);
	return roles.length >= 10 && roles.every((role) => role?.id && role.approvedRoots.length > 0 && role.filenameTokens.length > 0)
		&& roles.every((role) => Object.values(role.placementConstraints).every((value) => typeof value === 'boolean' || Number.isFinite(value)));
}
