/**
 * Runtime renderer/hydration for deterministic settlement ambient props.
 *
 * Geographic planning is isolated in `settlementAmbientPlacement.js`; texture/material preparation
 * lives in `settlementAmbientMaterials.js`. This file intentionally owns only scene representation,
 * optional repository-GLB hydration, audit and teardown. It never mutates terrain, roads, hydrology,
 * colliders or gameplay state.
 * @module world/settlementAmbientProps
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';
import { resolveWorldSurfacePlacement } from './WorldAssetPlacementPipeline.js';
import {
	SETTLEMENT_AMBIENT_PROP_POLICY,
	SETTLEMENT_AMBIENT_PROP_FAMILIES,
	SETTLEMENT_AMBIENT_FAMILY_IDS,
	checksumSettlementAmbientPlacements,
	createAmbientPropSurfaceQuery,
	generateSettlementAmbientPropPlacements,
} from './settlementAmbientPlacement.js';
import {
	createAmbientFallbackGeometry,
	createAmbientFallbackMaterial,
	placementTintColor,
	cloneAmbientModelWithWeatheredMaterials,
	validateAmbientPropAsset,
	disposeAmbientObjectResources,
} from './settlementAmbientMaterials.js';
import {
	SETTLEMENT_AMBIENT_GROUND_CONTACT_POLICY,
	createSettlementAmbientGroundContacts,
	disposeSettlementAmbientGroundContacts,
} from './settlementAmbientGroundContact.js';

export {
	SETTLEMENT_AMBIENT_PROP_POLICY,
	SETTLEMENT_AMBIENT_PROP_FAMILIES,
	SETTLEMENT_AMBIENT_FAMILY_IDS,
	checksumSettlementAmbientPlacements,
	createAmbientPropSurfaceQuery,
	generateSettlementAmbientPropPlacements,
	sampleAmbientPropTerrainFrame,
	distanceToAmbientRoads,
	nearestAmbientRoadSegment,
	projectPointToAmbientRoadSegment,
	buildAmbientRoadApronProfile,
} from './settlementAmbientPlacement.js';
export {
	createAmbientFallbackGeometry,
	createAmbientFallbackFabricTextures,
	createAmbientFallbackMaterial,
	applyAmbientPropWorldSpaceWeathering,
	measureAmbientPropAsset,
	validateAmbientPropAsset,
	placementTintColor,
} from './settlementAmbientMaterials.js';
export {
	SETTLEMENT_AMBIENT_GROUND_CONTACT_POLICY,
	createSettlementAmbientGroundContacts,
	disposeSettlementAmbientGroundContacts,
} from './settlementAmbientGroundContact.js';

const tempObject = new THREE.Object3D();
const tempMatrix = new THREE.Matrix4();
const inFlightUpgrades = new WeakMap();
const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1';
const FALLBACK_CLIMATE_BUCKETS = Object.freeze(['temperate', 'snow', 'ash']);

function fallbackScale(familyId, scale) {
	if (familyId === 'bench') return { x: scale * 1.02, y: scale, z: scale };
	return { x: scale, y: scale, z: scale };
}

function composeFallbackMatrix(placement) {
	tempObject.position.set(placement.x, placement.y, placement.z);
	tempObject.rotation.set(0, placement.yawRadians, 0);
	const scale = fallbackScale(placement.familyId, placement.scale);
	tempObject.scale.set(scale.x, scale.y, scale.z);
	tempObject.updateMatrix();
	return tempMatrix.copy(tempObject.matrix);
}

function fallbackClimateBucket(placement) {
	if (placement.snow >= 0.25 && placement.snow >= placement.valyria) return 'snow';
	if (placement.valyria >= 0.25) return 'ash';
	return 'temperate';
}

function fallbackClimateMaterialProfile(bucket, placements) {
	if (!placements.length || bucket === 'temperate') return { snow: 0, ash: 0 };
	const mean = (key) => placements.reduce((sum, placement) => sum + Number(placement[key] || 0), 0) / placements.length;
	return bucket === 'snow'
		? { snow: Math.max(0.28, Math.min(1, mean('snow'))), ash: 0 }
		: { snow: 0, ash: Math.max(0.28, Math.min(1, mean('valyria'))) };
}

function createFallbackFamilyMesh(familyId, climateBucket, placements) {
	if (!placements.length) return null;
	const climate = fallbackClimateMaterialProfile(climateBucket, placements);
	const mesh = new THREE.InstancedMesh(
		createAmbientFallbackGeometry(familyId),
		createAmbientFallbackMaterial(familyId, climate),
		placements.length,
	);
	mesh.name = `settlement-ambient-fallback-${familyId}-${climateBucket}`;
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
	placements.forEach((placement, index) => {
		mesh.setMatrixAt(index, composeFallbackMatrix(placement));
		mesh.setColorAt(index, placementTintColor(placement));
	});
	mesh.instanceMatrix.needsUpdate = true;
	if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	mesh.computeBoundingSphere?.();
	mesh.userData.placementIds = placements.map((placement) => placement.id);
	mesh.userData.familyId = familyId;
	mesh.userData.climateBucket = climateBucket;
	mesh.userData.climateMaterialProfile = Object.freeze(climate);
	mesh.userData.settlementAmbientFallback = true;
	return mesh;
}

export function createSettlementAmbientProps(options) {
	const placementResult = generateSettlementAmbientPropPlacements(options);
	const group = new THREE.Group();
	group.name = SETTLEMENT_AMBIENT_PROP_POLICY.groupName;
	const fallbackMeshes = [];
	for (const familyId of SETTLEMENT_AMBIENT_FAMILY_IDS) {
		for (const climateBucket of FALLBACK_CLIMATE_BUCKETS) {
			const placements = placementResult.placements.filter((placement) => (
				placement.familyId === familyId && fallbackClimateBucket(placement) === climateBucket
			));
			const mesh = createFallbackFamilyMesh(familyId, climateBucket, placements);
			if (mesh) fallbackMeshes.push(mesh);
		}
	}
	const groundContactResult = createSettlementAmbientGroundContacts(placementResult.placements, {
		sampleHeightMeters: options?.sampleHeightMeters,
	});
	group.add(groundContactResult.group, ...fallbackMeshes);
	group.userData.settlementAmbientPlacements = placementResult.placements;
	group.userData.settlementAmbientSources = [];
	group.userData.settlementAmbientGroundContact = groundContactResult.group;
	group.userData.settlementAmbientDisposed = false;
	group.userData.settlementAmbient = Object.freeze({
		policyId: SETTLEMENT_AMBIENT_PROP_POLICY.id,
		placementAuthority: SETTLEMENT_AMBIENT_PROP_POLICY.placementAuthority,
		renderOnly: true,
		gameplayInactive: true,
		canonicalGeographyUnchanged: true,
		placementChecksum: placementResult.stats.placementChecksum,
		placementCount: placementResult.stats.placedCount,
		targetCount: placementResult.stats.targetCount,
		familyCounts: placementResult.stats.familyCounts,
		climateCounts: placementResult.stats.climateCounts,
		roleCounts: placementResult.stats.roleCounts,
		routeApproachSeatCount: placementResult.stats.routeApproachSeatCount,
		logisticsShoulderCount: placementResult.stats.logisticsShoulderCount,
		meanLogisticsRoadDistanceMeters: placementResult.stats.meanLogisticsRoadDistanceMeters,
		maxLogisticsRoadDistanceMeters: placementResult.stats.maxLogisticsRoadDistanceMeters,
		fallbackDrawCalls: fallbackMeshes.length,
		fallbackClimateVariantCount: new Set(fallbackMeshes.map((mesh) => mesh.userData.climateBucket)).size,
		groundContactPolicyId: SETTLEMENT_AMBIENT_GROUND_CONTACT_POLICY.id,
		groundContactDrawCalls: groundContactResult.stats.drawCalls,
		groundContactPlacementCount: groundContactResult.stats.placementCount,
		assetState: 'procedural-fallback',
		hydratedPlacementCount: 0,
	});
	return Object.freeze({ group, placements: placementResult.placements, stats: placementResult.stats });
}

function contentLengthFromHeaders(response) {
	const direct = Number(response.headers.get('content-length'));
	if (Number.isFinite(direct) && direct >= 0) return direct;
	const range = response.headers.get('content-range') || '';
	const match = range.match(/\/(\d+)\s*$/);
	return match ? Number(match[1]) : null;
}

function looksLikeLfsPointer(bytes) {
	if (!bytes?.byteLength) return false;
	try {
		const prefix = new TextDecoder().decode(bytes.slice(0, 192)).trimStart();
		return prefix.startsWith(LFS_POINTER_PREFIX);
	} catch {
		return false;
	}
}

async function rangeProbeAmbientAsset(url, signal) {
	try {
		const response = await fetch(url, {
			method: 'GET',
			headers: { Range: 'bytes=0-511' },
			cache: 'no-store',
			signal,
		});
		if (!response.ok && response.status !== 206) return { load: false, reason: `http-${response.status}` };
		const bytes = new Uint8Array(await response.arrayBuffer());
		const contentLength = contentLengthFromHeaders(response);
		if (looksLikeLfsPointer(bytes)) return { load: false, reason: 'lfs-pointer', contentLength };
		if (Number.isFinite(contentLength) && contentLength < SETTLEMENT_AMBIENT_PROP_POLICY.hostedPreflightMinBytes) {
			return { load: false, reason: 'source-too-small', contentLength };
		}
		if (Number.isFinite(contentLength) && contentLength > SETTLEMENT_AMBIENT_PROP_POLICY.maximumHydratedSourceBytes) {
			return { load: false, reason: 'source-too-large', contentLength };
		}
		return { load: true, contentLength, binaryProbeBytes: bytes.byteLength };
	} catch (error) {
		return { load: false, reason: signal?.aborted ? 'aborted' : 'range-preflight-error', error };
	}
}

async function preflightAmbientAsset(url, signal) {
	try {
		const response = await fetch(url, { method: 'HEAD', cache: 'no-store', signal });
		if (response.ok) {
			const contentLength = contentLengthFromHeaders(response);
			if (Number.isFinite(contentLength)) {
				if (contentLength < SETTLEMENT_AMBIENT_PROP_POLICY.hostedPreflightMinBytes) {
					return { load: false, reason: 'lfs-pointer-or-source-too-small', contentLength };
				}
				if (contentLength > SETTLEMENT_AMBIENT_PROP_POLICY.maximumHydratedSourceBytes) {
					return { load: false, reason: 'source-too-large', contentLength };
				}
				return { load: true, contentLength };
			}
		}
		if (signal?.aborted) return { load: false, reason: 'aborted' };
		return rangeProbeAmbientAsset(url, signal);
	} catch (error) {
		if (signal?.aborted) return { load: false, reason: 'aborted', error };
		return rangeProbeAmbientAsset(url, signal);
	}
}

function normalizeHydratedClone(source, measurement, familyId, placement) {
	const wrapper = new THREE.Group();
	wrapper.name = `settlement-ambient-hydrated-${placement.id}`;
	const clone = cloneAmbientModelWithWeatheredMaterials(source, familyId, placement);
	const family = SETTLEMENT_AMBIENT_PROP_FAMILIES[familyId];
	const scale = family.targetHorizontalMeters * placement.scale / Math.max(measurement.horizontal, 1e-6);
	clone.position.set(-measurement.center.x, -measurement.bounds.min.y, -measurement.center.z);
	wrapper.add(clone);
	wrapper.scale.setScalar(scale);
	wrapper.position.set(placement.x, placement.y, placement.z);
	wrapper.rotation.y = placement.yawRadians;
	wrapper.userData.settlementAmbientHydrated = true;
	wrapper.userData.placementId = placement.id;
	wrapper.userData.familyId = familyId;
	wrapper.userData.assetUrl = family.assetUrl;
	wrapper.userData.authoredMapsPreserved = true;
	wrapper.userData.targetHorizontalMeters = placement.targetHorizontalMeters;
	wrapper.userData.distributionRole = placement.distributionRole;
	wrapper.userData.routeFacing = placement.routeFacing;
	return wrapper;
}

function hideFallbackPlacement(group, familyId, placementId) {
	const mesh = group.children.find((child) => (
		child?.userData?.settlementAmbientFallback
		&& child.userData.familyId === familyId
		&& child.userData.placementIds?.includes(placementId)
	));
	if (!mesh) return false;
	const index = mesh.userData.placementIds.indexOf(placementId);
	mesh.getMatrixAt(index, tempMatrix);
	tempMatrix.decompose(tempObject.position, tempObject.quaternion, tempObject.scale);
	tempObject.scale.setScalar(0);
	tempMatrix.compose(tempObject.position, tempObject.quaternion, tempObject.scale);
	mesh.setMatrixAt(index, tempMatrix);
	mesh.instanceMatrix.needsUpdate = true;
	return true;
}

function placementPolicyForAmbientProp(placement) {
	return {
		maxSlopeDegrees: SETTLEMENT_AMBIENT_PROP_POLICY.maximumSlopeDegrees,
		maxWaterDepth: 0.02,
		minRoadDistance: SETTLEMENT_AMBIENT_PROP_POLICY.minimumRoadDistanceMeters,
		maxRoadDistance: placement.distributionRole === 'logistics'
			? SETTLEMENT_AMBIENT_PROP_POLICY.maximumLogisticsRoadDistanceMeters
			: null,
		minSettlementDistance: SETTLEMENT_AMBIENT_PROP_POLICY.innerRadiusMeters - 2,
		maxSettlementDistance: SETTLEMENT_AMBIENT_PROP_POLICY.outerRadiusMeters + 2,
	};
}

function existingHydrationSummary(group) {
	const metadata = group?.userData?.settlementAmbient;
	if (!metadata || metadata.assetState !== 'active') return null;
	return Object.freeze({
		status: 'active',
		hydratedPlacementCount: metadata.hydratedPlacementCount || 0,
		activeFamilyCount: metadata.hydratedFamilyCount || 0,
		families: metadata.hydratedFamilies || Object.freeze([]),
		cached: true,
	});
}

async function hydrateAmbientFamily(group, hydratedGroup, familyId, { signal, surfaceQuery }) {
	const family = SETTLEMENT_AMBIENT_PROP_FAMILIES[familyId];
	const placements = (group.userData.settlementAmbientPlacements || []).filter((placement) => placement.familyId === familyId);
	if (!placements.length) return Object.freeze({ familyId, status: 'unused', placementCount: 0 });
	const preflight = await preflightAmbientAsset(family.assetUrl, signal);
	if (!preflight.load) {
		return Object.freeze({
			familyId,
			status: 'procedural-fallback',
			reason: preflight.reason,
			placementCount: placements.length,
			hostedContentLength: preflight.contentLength ?? null,
		});
	}

	const source = await new AssetLoader().loadModel(family.assetUrl, {
		fallbackColor: family.fallbackColor,
		fallbackSize: family.targetHorizontalMeters,
	});
	const validation = validateAmbientPropAsset(source);
	if (!validation.valid) {
		AssetLoader.disposeObject3D(source);
		return Object.freeze({ familyId, status: 'procedural-fallback', reason: validation.reason, placementCount: placements.length });
	}
	if (group.userData.settlementAmbientDisposed || signal?.aborted) {
		AssetLoader.disposeObject3D(source);
		return Object.freeze({ familyId, status: 'aborted', placementCount: placements.length });
	}
	group.userData.settlementAmbientSources.push(source);

	let hydratedPlacementCount = 0;
	for (const placement of placements) {
		if (signal?.aborted || group.userData.settlementAmbientDisposed) break;
		const wrapper = normalizeHydratedClone(source, validation.measurement, familyId, placement);
		const resolved = resolveWorldSurfacePlacement(wrapper, {
			surfaceQuery,
			placementPolicy: placementPolicyForAmbientProp(placement),
			requireSurfaceContext: true,
			snapToGround: true,
			footprintGrounding: 'never',
		});
		const roadDistance = resolved.surface?.roadDistance;
		const logisticsRoadValid = placement.distributionRole !== 'logistics'
			|| !Number.isFinite(roadDistance)
			|| roadDistance <= SETTLEMENT_AMBIENT_PROP_POLICY.maximumLogisticsRoadDistanceMeters + 1e-6;
		if (!resolved.ok || !logisticsRoadValid) {
			disposeAmbientObjectResources(wrapper, { disposeGeometry: false, disposeTextures: false });
			continue;
		}
		wrapper.userData.worldPlacementSurface = resolved.surface;
		wrapper.userData.worldPlacementPolicy = resolved.policy;
		hydratedGroup.add(wrapper);
		hideFallbackPlacement(group, familyId, placement.id);
		hydratedPlacementCount += 1;
	}

	return Object.freeze({
		familyId,
		status: hydratedPlacementCount > 0 ? 'active' : 'procedural-fallback',
		assetUrl: family.assetUrl,
		placementCount: placements.length,
		hydratedPlacementCount,
		primitiveCount: validation.meshes.length,
		hostedContentLength: preflight.contentLength ?? null,
		sourceMeasurement: Object.freeze({
			x: validation.measurement.size.x,
			y: validation.measurement.size.y,
			z: validation.measurement.size.z,
			horizontal: validation.measurement.horizontal,
		}),
	});
}

/** Opportunistically replaces fallback instances with real repository GLBs on desktop-class devices. */
export function upgradeSettlementAmbientPropAssets(group, {
	signal,
	isMobileClass = false,
	sampleHeightMeters,
	seaLevelMeters,
	seats,
	roadEdges,
} = {}) {
	if (!group) return Promise.resolve(Object.freeze({ status: 'missing-group' }));
	if (group.userData.settlementAmbientDisposed) return Promise.resolve(Object.freeze({ status: 'disposed' }));
	if (isMobileClass) return Promise.resolve(Object.freeze({ status: 'procedural-fallback', reason: 'mobile-budget', hydratedPlacementCount: 0 }));
	const cached = existingHydrationSummary(group);
	if (cached) return Promise.resolve(cached);
	if (inFlightUpgrades.has(group)) return inFlightUpgrades.get(group);
	if (typeof sampleHeightMeters !== 'function') return Promise.resolve(Object.freeze({ status: 'procedural-fallback', reason: 'missing-height-sampler', hydratedPlacementCount: 0 }));

	const surfaceQuery = createAmbientPropSurfaceQuery({ sampleHeightMeters, seaLevelMeters, seats, roadEdges });
	group.userData.settlementAmbient = Object.freeze({ ...group.userData.settlementAmbient, assetState: 'loading' });
	let hydratedGroup = group.children.find((child) => child?.name === SETTLEMENT_AMBIENT_PROP_POLICY.hydratedGroupName);
	if (!hydratedGroup) {
		hydratedGroup = new THREE.Group();
		hydratedGroup.name = SETTLEMENT_AMBIENT_PROP_POLICY.hydratedGroupName;
		group.add(hydratedGroup);
	}

	const task = (async () => {
		const families = [];
		for (const familyId of SETTLEMENT_AMBIENT_FAMILY_IDS) {
			if (signal?.aborted || group.userData.settlementAmbientDisposed) {
				families.push(Object.freeze({ familyId, status: 'aborted' }));
				continue;
			}
			try {
				families.push(await hydrateAmbientFamily(group, hydratedGroup, familyId, { signal, surfaceQuery }));
			} catch (error) {
				families.push(Object.freeze({ familyId, status: 'procedural-fallback', reason: 'hydrate-error', error: String(error?.message || error) }));
			}
		}
		const active = families.filter((entry) => entry.status === 'active');
		const hydratedPlacementCount = active.reduce((sum, entry) => sum + entry.hydratedPlacementCount, 0);
		const status = group.userData.settlementAmbientDisposed
			? 'disposed'
			: hydratedPlacementCount > 0 ? 'active' : 'procedural-fallback';
		if (!group.userData.settlementAmbientDisposed) {
			group.userData.settlementAmbient = Object.freeze({
				...group.userData.settlementAmbient,
				assetState: status,
				hydratedPlacementCount,
				hydratedFamilyCount: active.length,
				hydratedFamilies: Object.freeze(families),
			});
		}
		return Object.freeze({ status, hydratedPlacementCount, activeFamilyCount: active.length, families: Object.freeze(families) });
	})().finally(() => inFlightUpgrades.delete(group));
	inFlightUpgrades.set(group, task);
	return task;
}

export function auditSettlementAmbientProps(group) {
	const metadata = group?.userData?.settlementAmbient;
	const placements = group?.userData?.settlementAmbientPlacements || [];
	const errors = [];
	if (!metadata) errors.push('missing-metadata');
	if (metadata?.policyId !== SETTLEMENT_AMBIENT_PROP_POLICY.id) errors.push('policy-id-drift');
	if (metadata?.placementChecksum !== checksumSettlementAmbientPlacements(placements)) errors.push('placement-checksum-drift');
	if (metadata?.groundContactPolicyId !== SETTLEMENT_AMBIENT_GROUND_CONTACT_POLICY.id) errors.push('ground-contact-policy-drift');
	if (metadata?.groundContactPlacementCount !== placements.length) errors.push('ground-contact-count-drift');
	if (placements.some((placement) => ![placement.x, placement.y, placement.z, placement.slopeDegrees, placement.roadDistanceMeters].every(Number.isFinite))) errors.push('non-finite-placement');
	if (placements.some((placement) => placement.slopeDegrees > SETTLEMENT_AMBIENT_PROP_POLICY.maximumSlopeDegrees + 1e-6)) errors.push('slope-policy-breach');
	if (placements.some((placement) => placement.roadDistanceMeters < SETTLEMENT_AMBIENT_PROP_POLICY.minimumRoadDistanceMeters - 1e-6)) errors.push('road-clearance-breach');
	if (placements.some((placement) => placement.distributionRole === 'logistics' && placement.roadDistanceMeters > SETTLEMENT_AMBIENT_PROP_POLICY.maximumLogisticsRoadDistanceMeters + 1e-6)) errors.push('logistics-road-shoulder-breach');
	if (placements.some((placement) => placement.distributionRole === 'logistics' && (!placement.routeFacing || !Number.isInteger(placement.routeEdgeIndex) || !Number.isInteger(placement.routeSegmentIndex)))) errors.push('logistics-route-proof-missing');
	if (placements.some((placement) => placement.seatDistanceMeters < SETTLEMENT_AMBIENT_PROP_POLICY.innerRadiusMeters - 1e-6 || placement.seatDistanceMeters > SETTLEMENT_AMBIENT_PROP_POLICY.outerRadiusMeters + 1e-6)) errors.push('seat-apron-breach');
	const familyCounts = new Map();
	for (const placement of placements) familyCounts.set(placement.familyId, (familyCounts.get(placement.familyId) || 0) + 1);
	if (familyCounts.size < 2 && placements.length >= 4) errors.push('family-diversity-too-low');
	return Object.freeze({
		ok: errors.length === 0,
		errors: Object.freeze(errors),
		placementCount: placements.length,
		familyCounts: Object.freeze(Object.fromEntries(familyCounts)),
		metadata,
	});
}

export function disposeSettlementAmbientProps(group) {
	if (!group || group.userData.settlementAmbientDisposed) return;
	group.userData.settlementAmbientDisposed = true;
	const sourceSet = new Set(group.userData?.settlementAmbientSources || []);
	const contactGroup = group.userData.settlementAmbientGroundContact;
	if (contactGroup) disposeSettlementAmbientGroundContacts(contactGroup);
	for (const child of group.children) {
		if (child === contactGroup) continue;
		if (child?.userData?.settlementAmbientFallback) {
			disposeAmbientObjectResources(child, { disposeGeometry: true, disposeTextures: true });
		} else if (child?.name === SETTLEMENT_AMBIENT_PROP_POLICY.hydratedGroupName) {
			disposeAmbientObjectResources(child, { disposeGeometry: false, disposeTextures: false });
		}
	}
	for (const source of sourceSet) AssetLoader.disposeObject3D(source);
	group.clear();
	group.userData.settlementAmbientSources = [];
	group.userData.settlementAmbientGroundContact = null;
}
