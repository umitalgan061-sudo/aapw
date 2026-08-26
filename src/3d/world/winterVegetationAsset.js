/**
 * Optional real-asset upgrade for the procedural far-north snow pines.
 *
 * The repository keeps vegetation binaries in Git LFS. Some CI/dev/deployment checkouts can expose
 * the ~130 byte LFS pointer text instead of the actual GLB. `vegetation.js` must remain immediately
 * renderable in that state, so the procedural snow pine is still the authority for placement,
 * determinism and fallback visuals. This module only replaces its visible geometry after a verified
 * materialized winter GLB has loaded successfully.
 * @module world/winterVegetationAsset
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';

const PREFERRED_SNOW_PINE_ASSET = 'assets/models/vegetation/pine_Zt62gceKXZ.glb';
const BARE_WINTER_TREE_ASSET = 'assets/models/vegetation/winter_tree.glb';
const SNOW_DEAD_TREE_GROVE_ASSET = 'assets/models/vegetation/dead_trees_with_snow_iEuwXWner0.glb';

export const WINTER_VEGETATION_ASSET_POLICY = Object.freeze({
	id: 'winter-vegetation-materialized-asset-2026-08-21-v4',
	preferredSnowPineAsset: PREFERRED_SNOW_PINE_ASSET,
	bareWinterTreeAsset: BARE_WINTER_TREE_ASSET,
	groveAsset: SNOW_DEAD_TREE_GROVE_ASSET,
	candidates: Object.freeze([
		PREFERRED_SNOW_PINE_ASSET,
		BARE_WINTER_TREE_ASSET,
		SNOW_DEAD_TREE_GROVE_ASSET,
	]),
	proceduralTrunkName: 'vegetation-snow-pine-trunks',
	proceduralFoliageName: 'vegetation-snow-pine-foliage',
	targetHeightMeters: 8.6,
	minSourceHeightMeters: 0.05,
	// Hydrated browser QA measured the textured pine at 0.777 and the bare winter tree at 0.627
	// horizontal/height, while the seven-mesh dead-tree/stump grove is 1.416. A snow-pine point
	// represents one tree, so accept either single tree but reject grove-shaped replacements.
	maxHorizontalToHeightRatio: 1.05,
	// Preserve the source evergreen texture in shadowed needles while keeping bright foliage visibly
	// snow-laden. The previous 0.58..0.86 blend washed nearly the whole crown to white in browser QA.
	pineFoliageSnowColor: Object.freeze([0.86, 0.92, 0.94]),
	pineFoliageSnowMixMin: 0.30,
	pineFoliageSnowMixRange: 0.40,
	pineFoliageMinRoughness: 0.90,
	pineFoliageMacroScale: 0.019,
	pineFoliageMesoScale: 0.127,
	pineFoliageFineScale: 0.71,
	pineFoliageWeatheringStrength: 0.18,
	pineFoliageRoughnessVariation: 0.09,
	// A Git-LFS pointer is ~130 bytes. A real textured tree GLB is orders of magnitude larger. HEAD
	// preflight lets Firebase/static hosting reject an unhydrated pointer without downloading it into
	// GLTFLoader first. Keep the threshold deliberately tiny so it cannot reject a plausible real GLB.
	hostedPreflightMinBytes: 512,
	hostedPreflightCache: 'no-store',
});

const inFlightUpgrades = new WeakMap();

function makeStatus(status, extra = {}) {
	return Object.freeze({
		policyId: WINTER_VEGETATION_ASSET_POLICY.id,
		status,
		...extra,
	});
}

function makeProbeStatus(status, shouldLoad, extra = {}) {
	return Object.freeze({ status, shouldLoad, ...extra });
}

function findNamedChild(group, name) {
	return group?.children?.find((child) => child?.name === name) ?? null;
}

/** Returns the two deterministic procedural meshes whose instance matrices are reused by the GLB. */
export function findProceduralWinterMeshes(group) {
	return {
		trunkMesh: findNamedChild(group, WINTER_VEGETATION_ASSET_POLICY.proceduralTrunkName),
		foliageMesh: findNamedChild(group, WINTER_VEGETATION_ASSET_POLICY.proceduralFoliageName),
	};
}

/** AssetLoader's graceful model fallback is intentionally not considered a successful winter tree. */
export function isPlaceholderWinterAsset(model) {
	if (!model) return true;
	if (model.userData?.isPlaceholder) return true;
	let placeholder = false;
	model.traverse?.((node) => {
		if (node.userData?.isPlaceholder) placeholder = true;
	});
	return placeholder;
}

/**
 * GLTFLoader normally emits one material per primitive. Array-material meshes are rejected here
 * because `disposeVegetation()` historically owns simple Mesh/InstancedMesh resources and should not
 * gain a special disposal contract merely because an optional cosmetic asset loaded.
 */
export function collectWinterAssetMeshes(model) {
	const meshes = [];
	model?.updateMatrixWorld?.(true);
	model?.traverse?.((node) => {
		if (!node?.isMesh || !node.geometry?.getAttribute?.('position') || !node.material) return;
		if (Array.isArray(node.material)) return;
		meshes.push(node);
	});
	return meshes;
}

export function measureWinterAsset(model) {
	model?.updateMatrixWorld?.(true);
	const bounds = new THREE.Box3().setFromObject(model);
	if (bounds.isEmpty()) return null;
	const size = bounds.getSize(new THREE.Vector3());
	const center = bounds.getCenter(new THREE.Vector3());
	const horizontal = Math.max(size.x, size.z);
	const horizontalToHeightRatio = size.y > 0 ? horizontal / size.y : Infinity;
	return { bounds, size, center, horizontalToHeightRatio };
}

function hasFiniteMeasurement(measurement) {
	const values = [
		measurement.size.x,
		measurement.size.y,
		measurement.size.z,
		measurement.center.x,
		measurement.center.y,
		measurement.center.z,
		measurement.bounds.min.x,
		measurement.bounds.min.y,
		measurement.bounds.min.z,
		measurement.bounds.max.x,
		measurement.bounds.max.y,
		measurement.bounds.max.z,
		measurement.horizontalToHeightRatio,
	];
	return values.every(Number.isFinite);
}

export function validateWinterAsset(model, policy = WINTER_VEGETATION_ASSET_POLICY) {
	if (isPlaceholderWinterAsset(model)) return { valid: false, reason: 'placeholder' };
	const meshes = collectWinterAssetMeshes(model);
	if (meshes.length === 0) return { valid: false, reason: 'no-renderable-mesh' };
	const measurement = measureWinterAsset(model);
	if (!measurement) return { valid: false, reason: 'empty-bounds' };
	if (!hasFiniteMeasurement(measurement)) return { valid: false, reason: 'non-finite-bounds' };
	if (measurement.size.y < policy.minSourceHeightMeters) return { valid: false, reason: 'degenerate-height' };
	if (measurement.horizontalToHeightRatio > policy.maxHorizontalToHeightRatio) {
		return { valid: false, reason: 'implausibly-wide-tree' };
	}
	return { valid: true, meshes, measurement };
}

/** Maps the loaded model to an upright, ground-based 8.6 m reference tree before tree-local scale. */
export function createWinterAssetNormalization(measurement, targetHeightMeters = WINTER_VEGETATION_ASSET_POLICY.targetHeightMeters) {
	const scale = targetHeightMeters / measurement.size.y;
	const translateToBase = new THREE.Matrix4().makeTranslation(
		-measurement.center.x,
		-measurement.bounds.min.y,
		-measurement.center.z,
	);
	return new THREE.Matrix4().makeScale(scale, scale, scale).multiply(translateToBase);
}

/**
 * Converts only the preferred pine's alpha-cut foliage toward a cold snow palette. Keeping the
 * original map fragment first preserves its detailed silhouette/alpha and texture variation. Snow
 * coverage, albedo weathering, micro-normal and roughness now vary continuously in world space so
 * hydrated crowns do not repeat the same flat white treatment at every deterministic tree instance.
 */
export function applyWinterPineMaterialTreatment(material, assetUrl, policy = WINTER_VEGETATION_ASSET_POLICY) {
	if (!material || assetUrl !== policy.preferredSnowPineAsset) return material;
	material.metalness = 0;
	if (Number.isFinite(material.roughness)) material.roughness = Math.max(material.roughness, policy.pineFoliageMinRoughness);

	const isMappedFoliage = Boolean(material.map && material.transparent);
	material.userData = {
		...material.userData,
		winterPineTreatment: isMappedFoliage ? 'snow-foliage-shader' : 'winter-trunk-source-map',
	};
	if (!isMappedFoliage) return material;

	const [snowR, snowG, snowB] = policy.pineFoliageSnowColor;
	const priorCompile = material.onBeforeCompile;
	material.onBeforeCompile = function compileSnowPine(shader, renderer) {
		priorCompile?.call(this, shader, renderer);
		if (typeof shader.vertexShader === 'string') {
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', '#include <common>\nvarying vec3 vWinterPineWorldPosition;')
				.replace('#include <begin_vertex>', `#include <begin_vertex>
vec4 winterPineWorldPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
winterPineWorldPosition = instanceMatrix * winterPineWorldPosition;
#endif
vWinterPineWorldPosition = (modelMatrix * winterPineWorldPosition).xyz;`);
		}
		const commonMarker = '#include <common>';
		if (shader.fragmentShader.includes(commonMarker)) {
			shader.fragmentShader = shader.fragmentShader.replace(commonMarker, `${commonMarker}
varying vec3 vWinterPineWorldPosition;
float winterPineHash(vec2 p) {
	p = fract(p * vec2(123.34, 345.45));
	p += dot(p, p + 34.345);
	return fract(p.x * p.y);
}
float winterPineNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = winterPineHash(i);
	float b = winterPineHash(i + vec2(1.0, 0.0));
	float c = winterPineHash(i + vec2(0.0, 1.0));
	float d = winterPineHash(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`);
		}

		const marker = '#include <map_fragment>';
		if (!shader.fragmentShader.includes(marker)) return;
		shader.fragmentShader = shader.fragmentShader.replace(marker, `${marker}\n
			float winterFoliageLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
			float winterMacro = 0.5;
			float winterMeso = 0.5;
			float winterFine = 0.5;
			#ifdef USE_INSTANCING
			winterMacro = winterPineNoise(vWinterPineWorldPosition.xz * ${policy.pineFoliageMacroScale.toFixed(4)});
			winterMeso = winterPineNoise(vWinterPineWorldPosition.xz * ${policy.pineFoliageMesoScale.toFixed(4)} + vec2(19.7, -11.3));
			winterFine = winterPineNoise(vWinterPineWorldPosition.xz * ${policy.pineFoliageFineScale.toFixed(4)} + vec2(-7.1, 23.4));
			#endif
			float winterExposure = smoothstep(0.22, 0.78, winterMacro * 0.58 + winterMeso * 0.42);
			float winterSnowMix = ${policy.pineFoliageSnowMixMin.toFixed(3)}
				+ ${policy.pineFoliageSnowMixRange.toFixed(3)} * smoothstep(0.12, 0.52, winterFoliageLuma);
			winterSnowMix *= mix(0.78, 1.12, winterExposure);
			winterSnowMix = clamp(winterSnowMix, 0.18, 0.72);
			diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${snowR.toFixed(3)}, ${snowG.toFixed(3)}, ${snowB.toFixed(3)}), winterSnowMix);
			diffuseColor.rgb *= 1.0 + (winterMeso - 0.5) * ${policy.pineFoliageWeatheringStrength.toFixed(3)} + (winterFine - 0.5) * 0.055;`);

		const normalMarker = '#include <normal_fragment_maps>';
		if (shader.fragmentShader.includes(normalMarker)) {
			shader.fragmentShader = shader.fragmentShader.replace(normalMarker, `${normalMarker}
#ifdef USE_INSTANCING
vec2 winterMicroP = vWinterPineWorldPosition.xz * 0.84;
float winterNx = winterPineNoise(winterMicroP + vec2(0.11, 0.0)) - winterPineNoise(winterMicroP - vec2(0.11, 0.0));
float winterNz = winterPineNoise(winterMicroP + vec2(0.0, 0.11)) - winterPineNoise(winterMicroP - vec2(0.0, 0.11));
normal = normalize(normal + mat3(viewMatrix) * vec3(winterNx, 0.0, winterNz) * 0.045);
#endif`);
		}

		const roughnessMarker = '#include <roughnessmap_fragment>';
		if (shader.fragmentShader.includes(roughnessMarker)) {
			shader.fragmentShader = shader.fragmentShader.replace(roughnessMarker, `${roughnessMarker}
#ifdef USE_INSTANCING
roughnessFactor = clamp(roughnessFactor + (winterMeso - 0.5) * ${policy.pineFoliageRoughnessVariation.toFixed(3)} + (winterFine - 0.5) * 0.045, 0.78, 1.0);
#endif`);
		}
	};
	material.customProgramCacheKey = () => `${policy.id}:snow-foliage-v1`;
	material.needsUpdate = true;
	return material;
}

function cloneMaterialWithTextureCleanup(sourceMaterial, disposedTextures, assetUrl) {
	const material = sourceMaterial.clone();
	applyWinterPineMaterialTreatment(material, assetUrl);
	const originalDispose = material.dispose.bind(material);
	material.dispose = function disposeWinterAssetMaterial() {
		for (const key of Object.keys(material)) {
			const value = material[key];
			if (!value?.isTexture || disposedTextures.has(value)) continue;
			disposedTextures.add(value);
			value.dispose();
		}
		originalDispose();
	};
	return material;
}

function disposeRejectedModel(model) {
	if (!model) return;
	AssetLoader.disposeObject3D(model);
}

/**
 * Replacement meshes reuse the source geometries and textures, but not the source materials.
 * Material.dispose() does not dispose textures in Three.js, so releasing these now is safe and
 * prevents a successfully loaded source scene from retaining needless GPU material programs.
 */
function disposeSourceMaterials(modelMeshes) {
	const disposedMaterials = new Set();
	for (const mesh of modelMeshes) {
		const material = mesh.material;
		if (!material || disposedMaterials.has(material)) continue;
		disposedMaterials.add(material);
		material.dispose();
	}
}

function applyWinterAssetInstances({ group, sourceMesh, sourceFoliageMesh, modelMeshes, normalization, assetUrl }) {
	const count = sourceMesh.count;
	const treeMatrix = new THREE.Matrix4();
	const finalMatrix = new THREE.Matrix4();
	const addedMeshes = [];
	const disposedTextures = new Set();

	for (let meshIndex = 0; meshIndex < modelMeshes.length; meshIndex++) {
		const sourceAssetMesh = modelMeshes[meshIndex];
		const material = cloneMaterialWithTextureCleanup(sourceAssetMesh.material, disposedTextures, assetUrl);
		const instanced = new THREE.InstancedMesh(sourceAssetMesh.geometry, material, count);
		instanced.name = `vegetation-snow-asset-${meshIndex}`;
		instanced.instanceMatrix.setUsage(THREE.StaticDrawUsage);
		instanced.castShadow = sourceMesh.castShadow || sourceFoliageMesh.castShadow;
		instanced.receiveShadow = sourceMesh.receiveShadow || sourceFoliageMesh.receiveShadow;
		instanced.userData.winterVegetationAsset = Object.freeze({
			assetUrl,
			meshIndex,
			materialTreatment: material.userData?.winterPineTreatment ?? 'source',
		});

		for (let instanceIndex = 0; instanceIndex < count; instanceIndex++) {
			sourceMesh.getMatrixAt(instanceIndex, treeMatrix);
			finalMatrix.copy(treeMatrix).multiply(normalization).multiply(sourceAssetMesh.matrixWorld);
			instanced.setMatrixAt(instanceIndex, finalMatrix);
		}
		instanced.instanceMatrix.needsUpdate = true;
		group.add(instanced);
		addedMeshes.push(instanced);
	}
	return addedMeshes;
}

function markNorthClimateRepresentation(group, assetUrl, meshCount, treeCount) {
	const previous = group.userData.northClimateVegetation ?? {};
	group.userData.northClimateVegetation = Object.freeze({
		...previous,
		liveRepresentation: 'materialized-instanced-winter-glb',
		winterAssetUrl: assetUrl,
		winterAssetMeshCount: meshCount,
		winterAssetTreeCount: treeCount,
		winterAssetTreatment: assetUrl === WINTER_VEGETATION_ASSET_POLICY.preferredSnowPineAsset
			? 'textured-pine-snow-foliage'
			: 'source-material',
	});
}

function markCancelled(group, treeCount, attemptedAssets, reason = 'abort-signal') {
	const status = makeStatus('cancelled', { treeCount, attemptedAssets, reason });
	if (group?.userData) group.userData.winterVegetationAssetUpgrade = status;
	return status;
}

function headerValue(headers, name) {
	if (!headers || typeof headers.get !== 'function') return null;
	return headers.get(name) ?? headers.get(name.toLowerCase()) ?? null;
}

/**
 * Cheap hosting preflight. It deliberately does not try to parse the GLB: HEAD is enough to reject
 * the two deployment failures we can identify before GLTFLoader runs — an HTTP miss and a tiny/text
 * Git-LFS pointer response. Unknown/unsupported HEAD behavior is fail-open because AssetLoader still
 * validates the real model and preserves the procedural fallback.
 */
export async function probeHostedWinterAsset(assetUrl, {
	fetchImpl = globalThis.fetch,
	signal,
	minBytes = WINTER_VEGETATION_ASSET_POLICY.hostedPreflightMinBytes,
	cache = WINTER_VEGETATION_ASSET_POLICY.hostedPreflightCache,
} = {}) {
	if (typeof fetchImpl !== 'function') {
		return makeProbeStatus('unknown', true, { reason: 'fetch-unavailable' });
	}

	let response;
	try {
		response = await fetchImpl(assetUrl, { method: 'HEAD', cache, signal });
	} catch (error) {
		if (signal?.aborted) return makeProbeStatus('cancelled', false, { reason: 'abort-signal' });
		return makeProbeStatus('unknown', true, { reason: 'head-failed' });
	}

	if (signal?.aborted) return makeProbeStatus('cancelled', false, { reason: 'abort-signal' });
	const statusCode = Number(response?.status);
	if (!response?.ok) {
		if (statusCode === 405 || statusCode === 501) {
			return makeProbeStatus('unknown', true, { reason: 'head-unsupported', statusCode });
		}
		return makeProbeStatus('rejected', false, { reason: 'http-error', statusCode });
	}

	const rawLength = headerValue(response.headers, 'content-length');
	const contentLength = rawLength == null ? null : Number.parseInt(rawLength, 10);
	if (Number.isFinite(contentLength) && contentLength > 0 && contentLength < minBytes) {
		return makeProbeStatus('rejected', false, {
			reason: 'pointer-sized-response',
			contentLength,
			minBytes,
		});
	}

	const contentType = String(headerValue(response.headers, 'content-type') ?? '').toLowerCase();
	if (contentType.startsWith('text/')) {
		return makeProbeStatus('rejected', false, { reason: 'text-response', contentLength, contentType });
	}

	return makeProbeStatus('accepted', true, { reason: 'hosted-binary-candidate', contentLength, contentType });
}

async function defaultWinterAssetProbe(assetUrl, options) {
	if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
		return makeProbeStatus('skipped', true, { reason: 'non-browser-runtime' });
	}
	return probeHostedWinterAsset(assetUrl, { ...options, fetchImpl: window.fetch.bind(window) });
}

async function performWinterVegetationAssetUpgrade(group, {
	assetLoader,
	assetProbe,
	candidates,
	targetHeightMeters,
	signal,
}) {
	const { trunkMesh, foliageMesh } = findProceduralWinterMeshes(group);
	if (!trunkMesh || !foliageMesh || trunkMesh.count <= 0) {
		const status = makeStatus('no-winter-trees', { attemptedAssets: 0 });
		if (group?.userData) group.userData.winterVegetationAssetUpgrade = status;
		return status;
	}

	if (signal?.aborted) return markCancelled(group, trunkMesh.count, 0);

	group.userData.winterVegetationAssetUpgrade = makeStatus('loading', {
		treeCount: trunkMesh.count,
		attemptedAssets: 0,
	});

	const rejected = [];
	for (const assetUrl of candidates) {
		if (signal?.aborted) return markCancelled(group, trunkMesh.count, rejected.length);

		if (assetProbe) {
			let probe;
			try {
				probe = await assetProbe(assetUrl, { signal });
			} catch (error) {
				if (signal?.aborted) return markCancelled(group, trunkMesh.count, rejected.length);
				// Probe is an optimization/diagnostic, not a new availability authority. Unexpected probe
				// failures therefore fall through to the proven loader + placeholder validation path.
				probe = makeProbeStatus('unknown', true, { reason: 'probe-threw' });
			}
			if (signal?.aborted || probe?.status === 'cancelled') {
				return markCancelled(group, trunkMesh.count, rejected.length);
			}
			if (probe?.shouldLoad === false) {
				rejected.push(Object.freeze({
					assetUrl,
					reason: `preflight-${probe.reason ?? probe.status ?? 'rejected'}`,
					preflightStatus: probe.status ?? 'rejected',
					contentLength: probe.contentLength ?? null,
					statusCode: probe.statusCode ?? null,
				}));
				continue;
			}
		}

		let model;
		try {
			model = await assetLoader.loadModel(assetUrl, { fallbackColor: 0xdce8ea, fallbackSize: 1 });
		} catch (error) {
			if (signal?.aborted) return markCancelled(group, trunkMesh.count, rejected.length);
			rejected.push(Object.freeze({ assetUrl, reason: 'loader-threw' }));
			continue;
		}

		if (signal?.aborted) {
			disposeRejectedModel(model);
			return markCancelled(group, trunkMesh.count, rejected.length + 1);
		}

		const validation = validateWinterAsset(model);
		if (!validation.valid) {
			rejected.push(Object.freeze({ assetUrl, reason: validation.reason }));
			disposeRejectedModel(model);
			continue;
		}

		const normalization = createWinterAssetNormalization(validation.measurement, targetHeightMeters);
		const addedMeshes = applyWinterAssetInstances({
			group,
			sourceMesh: trunkMesh,
			sourceFoliageMesh: foliageMesh,
			modelMeshes: validation.meshes,
			normalization,
			assetUrl,
		});
		disposeSourceMaterials(validation.meshes);

		trunkMesh.visible = false;
		foliageMesh.visible = false;
		markNorthClimateRepresentation(group, assetUrl, addedMeshes.length, trunkMesh.count);
		const status = makeStatus('active', {
			assetUrl,
			treeCount: trunkMesh.count,
			meshCount: addedMeshes.length,
			attemptedAssets: rejected.length + 1,
			rejected: Object.freeze(rejected),
		});
		group.userData.winterVegetationAssetUpgrade = status;
		return status;
	}

	const status = makeStatus('procedural-fallback', {
		treeCount: trunkMesh.count,
		attemptedAssets: rejected.length,
		rejected: Object.freeze(rejected),
	});
	group.userData.winterVegetationAssetUpgrade = status;
	return status;
}

/**
 * Attempts each known winter GLB in order. Pointer-only/corrupt/missing/implausible assets are
 * rejected and the already-visible procedural snow pines remain untouched. In browsers a cheap HEAD
 * preflight rejects a hosted LFS pointer before GLTFLoader downloads it. On success, every GLB
 * primitive is instanced using the exact deterministic snow-pine matrices; the procedural pair is
 * only hidden after all replacement meshes are ready. Re-entrant callers share one in-flight load,
 * and an optional AbortSignal can cancel a page that is tearing down without leaving detached meshes.
 */
export function upgradeWinterVegetationAssets(group, {
	assetLoader = new AssetLoader(),
	assetProbe = typeof window !== 'undefined' && typeof window.fetch === 'function'
		? defaultWinterAssetProbe
		: null,
	candidates = WINTER_VEGETATION_ASSET_POLICY.candidates,
	targetHeightMeters = WINTER_VEGETATION_ASSET_POLICY.targetHeightMeters,
	signal,
} = {}) {
	if (!group?.userData) return Promise.resolve(makeStatus('invalid-group', { attemptedAssets: 0 }));
	const existing = group.userData.winterVegetationAssetUpgrade;
	if (['active', 'procedural-fallback', 'no-winter-trees', 'cancelled'].includes(existing?.status)) {
		return Promise.resolve(existing);
	}

	const inFlight = inFlightUpgrades.get(group);
	if (inFlight) return inFlight;

	const promise = performWinterVegetationAssetUpgrade(group, {
		assetLoader,
		assetProbe,
		candidates,
		targetHeightMeters,
		signal,
	}).finally(() => {
		if (inFlightUpgrades.get(group) === promise) inFlightUpgrades.delete(group);
	});
	inFlightUpgrades.set(group, promise);
	return promise;
}
