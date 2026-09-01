import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';
import {
	analyzeMaterialSurfaces,
	createMaterialManifest,
	validateMaterialAssignment,
} from '../materials/MaterialAssignmentCore.js';
import { resolveWorldSurfacePlacement } from '../world/WorldAssetPlacementPipeline.js';

export const CART_CHARIOT_ASSET_URL = '/assets/models/fbx/ancient_horse_chariot_mauryan_era.glb';
const MIN_HYDRATED_GLTF_BYTES = 1024;
const GROUND_CLEARANCE_METERS = 0.015;
const sharedAssetLoader = new AssetLoader();
let sharedTemplatePromise = null;

function finitePositive(value) {
	return Number.isFinite(value) && value > 0;
}

function materialAppearanceSignature(material) {
	if (!material) return 'missing';
	const textureKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
	const textures = textureKeys
		.filter((key) => Boolean(material[key]))
		.map((key) => `${key}:${material[key]?.uuid || 'texture'}`)
		.join('|');
	const color = material.color?.getHexString?.() || 'none';
	return `${material.type || 'material'}:${color}:${material.roughness ?? 'na'}:${material.metalness ?? 'na'}:${textures}`;
}

function inspectAuthoredMaterials(model) {
	const analysis = analyzeMaterialSurfaces(model);
	const validation = validateMaterialAssignment(model);
	const materials = [];
	let texturedMaterialCount = 0;
	for (const mesh of analysis.meshes) {
		const slots = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
		for (const material of slots) {
			if (!material) continue;
			materials.push(material);
			if (material.map || material.normalMap || material.roughnessMap || material.metalnessMap || material.aoMap) {
				texturedMaterialCount += 1;
			}
		}
	}
	const appearanceCount = new Set(materials.map(materialAppearanceSignature)).size;
	const richEnough = validation.ok && (texturedMaterialCount > 0 || appearanceCount >= 2);
	return {
		ok: richEnough,
		analysis,
		validation,
		materialCount: materials.length,
		texturedMaterialCount,
		appearanceCount,
		reason: !validation.ok
			? validation.errors.join(',') || 'material-validation-failed'
			: richEnough
				? 'authored-materials-preserved'
				: 'flat-single-appearance',
	};
}

function normalizeChariotModel(model, {
	targetLengthMeters,
	targetWidthMeters,
	maxHeightMeters,
	forwardOffsetMeters,
}) {
	model.updateMatrixWorld(true);
	let bounds = new THREE.Box3().setFromObject(model);
	let size = bounds.getSize(new THREE.Vector3());
	if (![size.x, size.y, size.z].every(finitePositive)) return { ok: false, reason: 'invalid-source-bounds' };

	// The imported owner asset may have been authored along X or Z. Runtime carts face local +Z, so
	// align the longest horizontal axis to +Z before fitting it into the existing road/collision envelope.
	if (size.x > size.z) {
		model.rotation.y += Math.PI / 2;
		model.updateMatrixWorld(true);
		bounds = new THREE.Box3().setFromObject(model);
		size = bounds.getSize(new THREE.Vector3());
	}

	const scale = Math.min(
		targetLengthMeters / size.z,
		targetWidthMeters / size.x,
		maxHeightMeters / size.y,
	);
	if (!finitePositive(scale)) return { ok: false, reason: 'invalid-fit-scale' };
	model.scale.multiplyScalar(scale);
	model.updateMatrixWorld(true);

	bounds = new THREE.Box3().setFromObject(model);
	const center = bounds.getCenter(new THREE.Vector3());
	model.position.x -= center.x;
	model.position.y += -bounds.min.y + GROUND_CLEARANCE_METERS;
	model.position.z += forwardOffsetMeters - center.z;
	model.updateMatrixWorld(true);

	bounds = new THREE.Box3().setFromObject(model);
	size = bounds.getSize(new THREE.Vector3());
	const fitted = [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z, size.x, size.y, size.z]
		.every(Number.isFinite);
	if (!fitted) return { ok: false, reason: 'non-finite-fitted-bounds' };
	if (size.x > targetWidthMeters + 0.02 || size.z > targetLengthMeters + 0.02 || size.y > maxHeightMeters + 0.02) {
		return { ok: false, reason: 'fit-envelope-exceeded' };
	}
	return {
		ok: true,
		bounds: {
			min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
			max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
			size: { x: size.x, y: size.y, z: size.z },
		},
	};
}

async function preflightHydratedAsset(url, fetchImpl) {
	if (typeof fetchImpl !== 'function') return { ok: false, reason: 'fetch-unavailable' };
	try {
		const response = await fetchImpl(url, { method: 'HEAD', cache: 'no-store' });
		if (!response?.ok) return { ok: false, reason: `http-${response?.status || 'error'}` };
		const contentLength = Number(response.headers?.get?.('content-length'));
		if (!Number.isFinite(contentLength) || contentLength < MIN_HYDRATED_GLTF_BYTES) {
			return { ok: false, reason: 'lfs-pointer-or-unknown-length', contentLength };
		}
		return { ok: true, contentLength };
	} catch {
		return { ok: false, reason: 'preflight-failed' };
	}
}

async function loadTemplate({ assetLoader, fetchImpl }) {
	const preflight = await preflightHydratedAsset(CART_CHARIOT_ASSET_URL, fetchImpl);
	if (!preflight.ok) return { ok: false, reason: preflight.reason, preflight };
	const model = await assetLoader.loadModel(CART_CHARIOT_ASSET_URL, { fallbackColor: 0x8b2232, fallbackSize: 1.4 });
	if (!model || model.userData?.isPlaceholder) return { ok: false, reason: 'placeholder-model', preflight };
	const materials = inspectAuthoredMaterials(model);
	if (!materials.ok) return { ok: false, reason: materials.reason, preflight, materials };
	model.traverse((node) => {
		if (!node?.isMesh) return;
		node.castShadow = true;
		node.receiveShadow = true;
	});
	return { ok: true, model, materials, preflight };
}

function acquireTemplate({ assetLoader, fetchImpl, useSharedTemplate }) {
	if (!useSharedTemplate) return loadTemplate({ assetLoader, fetchImpl });
	if (!sharedTemplatePromise) sharedTemplatePromise = loadTemplate({ assetLoader, fetchImpl });
	return sharedTemplatePromise;
}

/**
 * Starts a non-blocking visual upgrade for one existing road-bound cart. The gameplay root remains
 * the movement/collision authority; this helper only replaces the primitive fallback's appearance
 * after a real, hydrated, materially-distinct owner asset has passed validation.
 */
export function beginCartVisualAssetUpgrade({
	cartRoot,
	cartId,
	edge,
	fallbackChildren = [...(cartRoot?.children || [])],
	targetLengthMeters,
	targetWidthMeters,
	maxHeightMeters = 2.6,
	forwardOffsetMeters = 0,
	assetLoader = sharedAssetLoader,
	fetchImpl = globalThis.fetch?.bind(globalThis),
} = {}) {
	let disposed = false;
	let attachedModel = null;
	const useSharedTemplate = assetLoader === sharedAssetLoader;

	const ready = (async () => {
		if (!cartRoot || !finitePositive(targetLengthMeters) || !finitePositive(targetWidthMeters)) {
			return { ok: false, reason: 'invalid-cart-visual-options' };
		}
		const template = await acquireTemplate({ assetLoader, fetchImpl, useSharedTemplate });
		if (!template.ok || disposed) return { ...template, ok: false, reason: disposed ? 'disposed-before-attach' : template.reason };

		const model = template.model.clone(true);
		model.name = `${cartId || 'cart'}-real-chariot`;
		model.userData.assetId = 'owner_model_ancient_horse_chariot_mauryan_era_572dafc9ee364dcf';
		model.userData.assetSrc = CART_CHARIOT_ASSET_URL;
		model.userData.assetCategory = 'road-vehicle';
		const fit = normalizeChariotModel(model, {
			targetLengthMeters,
			targetWidthMeters,
			maxHeightMeters,
			forwardOffsetMeters,
		});
		if (!fit.ok) return { ok: false, reason: fit.reason, preflight: template.preflight, materials: template.materials };

		const placementGate = resolveWorldSurfacePlacement(cartRoot, {
			metadata: { id: cartId, category: 'road-vehicle' },
			requireSurfaceContext: false,
			snapToGround: false,
		});
		if (!placementGate.ok) return { ok: false, reason: placementGate.error || 'shared-placement-validation-failed' };

		const placement = {
			binding: 'existing-road-edge',
			dynamic: true,
			edge: { fromId: edge?.fromId || '', toId: edge?.toId || '' },
			initialWorldPosition: { x: cartRoot.position.x, y: cartRoot.position.y, z: cartRoot.position.z },
			initialYawRadians: cartRoot.rotation.y,
			bounds: fit.bounds,
		};
		const manifest = createMaterialManifest(model, {
			metadata: {
				id: model.userData.assetId,
				name: model.name,
				category: 'road-vehicle',
				src: CART_CHARIOT_ASSET_URL,
			},
			placement,
		});
		if (!manifest.validation.ok) return { ok: false, reason: manifest.validation.errors.join(',') || 'manifest-material-validation-failed' };
		if (disposed) return { ok: false, reason: 'disposed-before-attach' };

		model.userData.cartVisualManifest = manifest;
		cartRoot.userData.cartVisualManifest = manifest;
		cartRoot.userData.cartVisualMode = 'real-chariot';
		cartRoot.add(model);
		attachedModel = model;
		for (const child of fallbackChildren) child.visible = false;
		return {
			ok: true,
			mode: 'real-chariot',
			model,
			manifest,
			bounds: fit.bounds,
			material: {
				meshCount: template.materials.analysis.meshCount,
				surfaceCount: template.materials.analysis.surfaceCount,
				texturedMaterialCount: template.materials.texturedMaterialCount,
				appearanceCount: template.materials.appearanceCount,
			},
			preflight: template.preflight,
		};
	})().catch((error) => ({ ok: false, reason: 'visual-upgrade-error', error: String(error?.message || error) }));

	return {
		ready,
		dispose() {
			disposed = true;
		if (attachedModel?.parent === cartRoot) cartRoot.remove(attachedModel);
		attachedModel = null;
		},
	};
}
