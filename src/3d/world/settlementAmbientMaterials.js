/**
 * Material, fallback-geometry and imported-model preparation for settlement ambient props.
 *
 * Geographic placement lives in `settlementAmbientPlacement.js`; this module never chooses a world
 * coordinate. It turns those deterministic placements into weathered render assets. Repository GLB
 * maps are preserved, while a world-space macro/meso/fine weathering layer prevents cloned props
 * from reading as identical toys. The inexpensive fallback path has deterministic albedo, roughness
 * and tangent-space normal fabric so mobile/LFS fallback is not a flat-colour primitive.
 * @module world/settlementAmbientMaterials
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
	SETTLEMENT_AMBIENT_PROP_FAMILIES,
	SETTLEMENT_AMBIENT_PROP_POLICY,
} from './settlementAmbientPlacement.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const finite = (value, fallback = 0) => {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
};

function fnv1a(text) {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function fallbackFabricHash(x, y, seed) {
	let value = Math.imul((x + 1) ^ seed, 0x45d9f3b) ^ Math.imul((y + 7) ^ (seed >>> 1), 0x27d4eb2d);
	value ^= value >>> 16;
	value = Math.imul(value, 0x45d9f3b);
	value ^= value >>> 15;
	return (value >>> 0) / 4294967295;
}

function smoothHashNoise(x, y, seed) {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	let fx = x - ix;
	let fy = y - iy;
	fx = fx * fx * (3 - 2 * fx);
	fy = fy * fy * (3 - 2 * fy);
	const a = fallbackFabricHash(ix, iy, seed);
	const b = fallbackFabricHash(ix + 1, iy, seed);
	const c = fallbackFabricHash(ix, iy + 1, seed);
	const d = fallbackFabricHash(ix + 1, iy + 1, seed);
	return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

function createFabricHeightField(familyId, size, seed) {
	const field = new Float32Array(size * size);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const nx = x / size;
			const ny = y / size;
			const broad = smoothHashNoise(nx * 7.4, ny * 7.4, seed ^ 0x7138a91d);
			const meso = smoothHashNoise(nx * 21.0 + broad * 0.8, ny * 19.0 - broad * 0.6, seed ^ 0x19f2c45b);
			const fine = smoothHashNoise(nx * 53.0, ny * 49.0, seed ^ 0x7ea55103);
			let height;
			if (familyId === 'bench') {
				const mineral = broad * 0.52 + meso * 0.34 + fine * 0.14;
				const vein = 1 - Math.min(1, Math.abs(Math.sin((nx * 7.8 + ny * 3.1 + broad * 1.7) * Math.PI)) * 2.6);
				height = clamp01(mineral * 0.91 + vein * 0.09);
			} else {
				const warp = (broad - 0.5) * 1.7 + (meso - 0.5) * 0.55;
				const grainPhase = (nx * 15.5 + ny * 1.7 + warp) * Math.PI;
				const grain = 0.5 + 0.5 * Math.sin(grainPhase);
				const secondaryGrain = 0.5 + 0.5 * Math.sin((nx * 31.0 - ny * 2.2 + meso * 1.4) * Math.PI);
				const knotDx = nx - (0.30 + broad * 0.28);
				const knotDy = ny - (0.26 + meso * 0.42);
				const knot = Math.exp(-(knotDx * knotDx * 28 + knotDy * knotDy * 78));
				height = clamp01(grain * 0.52 + secondaryGrain * 0.15 + broad * 0.19 + fine * 0.14 - knot * 0.12);
			}
			field[y * size + x] = height;
		}
	}
	return field;
}

function sampleWrappedHeight(field, size, x, y) {
	const wrappedX = (x % size + size) % size;
	const wrappedY = (y % size + size) % size;
	return field[wrappedY * size + wrappedX];
}

function writeNormalPixel(target, index, dx, dy, strength) {
	const nx = -dx * strength;
	const ny = -dy * strength;
	const nz = 1;
	const inverseLength = 1 / Math.max(1e-6, Math.hypot(nx, ny, nz));
	target[index] = Math.round((nx * inverseLength * 0.5 + 0.5) * 255);
	target[index + 1] = Math.round((ny * inverseLength * 0.5 + 0.5) * 255);
	target[index + 2] = Math.round((nz * inverseLength * 0.5 + 0.5) * 255);
	target[index + 3] = 255;
}

/** Deterministic fallback albedo/roughness/normal fabric for one prop family. */
export function createAmbientFallbackFabricTextures(familyId) {
	const policy = SETTLEMENT_AMBIENT_PROP_POLICY;
	const size = policy.fallbackFabricTextureSize;
	const seed = fnv1a(`ambient-fabric-v3:${familyId}`);
	const field = createFabricHeightField(familyId, size, seed);
	const colorData = new Uint8Array(size * size * 4);
	const roughnessData = new Uint8Array(size * size * 4);
	const normalData = new Uint8Array(size * size * 4);
	const isStone = familyId === 'bench';

	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const pixel = y * size + x;
			const index = pixel * 4;
			const height = field[pixel];
			const fine = fallbackFabricHash(x, y, seed ^ 0x4c2151c7);
			if (isStone) {
				const warmMineral = clamp01(height * 0.74 + fine * 0.26);
				colorData[index] = Math.round(151 + warmMineral * 42);
				colorData[index + 1] = Math.round(146 + warmMineral * 39);
				colorData[index + 2] = Math.round(134 + warmMineral * 35);
			} else {
				const timber = clamp01(height * 0.82 + fine * 0.18);
				colorData[index] = Math.round(128 + timber * 66);
				colorData[index + 1] = Math.round(87 + timber * 48);
				colorData[index + 2] = Math.round(52 + timber * 31);
			}
			colorData[index + 3] = 255;

			const roughness = isStone
				? 0.72 + (1 - height) * 0.25
				: 0.68 + (1 - height) * 0.22 + fine * 0.08;
			const roughnessByte = Math.round(clamp01(roughness) * 255);
			roughnessData[index] = roughnessByte;
			roughnessData[index + 1] = roughnessByte;
			roughnessData[index + 2] = roughnessByte;
			roughnessData[index + 3] = 255;

			const dx = sampleWrappedHeight(field, size, x + 1, y) - sampleWrappedHeight(field, size, x - 1, y);
			const dy = sampleWrappedHeight(field, size, x, y + 1) - sampleWrappedHeight(field, size, x, y - 1);
			writeNormalPixel(normalData, index, dx, dy, isStone ? 2.4 : 3.1);
		}
	}

	const map = new THREE.DataTexture(colorData, size, size, THREE.RGBAFormat);
	map.colorSpace = THREE.SRGBColorSpace;
	const roughnessMap = new THREE.DataTexture(roughnessData, size, size, THREE.RGBAFormat);
	const normalMap = new THREE.DataTexture(normalData, size, size, THREE.RGBAFormat);
	for (const texture of [map, roughnessMap, normalMap]) {
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.RepeatWrapping;
		texture.repeat.set(policy.fallbackFabricRepeat, policy.fallbackFabricRepeat);
		texture.needsUpdate = true;
		texture.userData.settlementAmbientFallbackFabric = true;
		texture.userData.settlementAmbientFamilyId = familyId;
	}
	return Object.freeze({ map, roughnessMap, normalMap });
}

function weatheringShaderKey(kind, snow = 0, ash = 0) {
	return `settlement-ambient-fabric-v3:${kind}:s${Math.round(snow * 5)}:a${Math.round(ash * 5)}`;
}

/** Adds deterministic world-space albedo, micro-normal and roughness breakup without replacing maps. */
export function applyAmbientPropWorldSpaceWeathering(material, { kind = 'wood', snow = 0, ash = 0 } = {}) {
	if (!material || !material.isMaterial) return material;
	const snowAmount = clamp01(snow);
	const ashAmount = clamp01(ash);
	const roughnessBase = kind === 'stone' ? 0.86 : kind === 'metal' ? 0.56 : 0.76;
	const normalGain = kind === 'stone' ? 0.095 : kind === 'metal' ? 0.028 : 0.068;
	const previous = material.onBeforeCompile?.bind(material);
	const previousCacheKey = material.customProgramCacheKey?.bind(material);
	material.userData ||= {};
	material.userData.settlementAmbientWeathering = Object.freeze({
		worldSpace: true,
		multiScaleAlbedo: true,
		microNormal: true,
		roughnessVariation: true,
		authoredMapsPreserved: Boolean(material.map || material.normalMap || material.roughnessMap),
		snowAmount,
		ashAmount,
		kind,
	});

	material.onBeforeCompile = (shader, renderer) => {
		previous?.(shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vAmbientPropWorldPosition;')
			.replace('#include <begin_vertex>', `#include <begin_vertex>
vec4 ambientPropWorldPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
ambientPropWorldPosition = instanceMatrix * ambientPropWorldPosition;
#endif
vAmbientPropWorldPosition = (modelMatrix * ambientPropWorldPosition).xyz;`);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>
varying vec3 vAmbientPropWorldPosition;
float ambientPropHash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
float ambientPropNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = ambientPropHash(i);
  float b = ambientPropHash(i + vec2(1.0, 0.0));
  float c = ambientPropHash(i + vec2(0.0, 1.0));
  float d = ambientPropHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`)
			.replace('#include <color_fragment>', `#include <color_fragment>
vec2 ambientPropXZ = vAmbientPropWorldPosition.xz;
vec2 ambientWarp = vec2(
  ambientPropNoise(ambientPropXZ * 0.0049 + vec2(7.3, -4.8)),
  ambientPropNoise(ambientPropXZ * 0.0061 + vec2(-3.2, 11.4))
) - 0.5;
float ambientMacro = ambientPropNoise((ambientPropXZ + ambientWarp * 31.0) * 0.013 + vec2(7.3, -4.8));
float ambientMeso = ambientPropNoise((ambientPropXZ - ambientWarp * 11.0) * 0.067 + vec2(-19.1, 11.7));
float ambientFine = ambientPropNoise(ambientPropXZ * 0.47 + vec2(31.9, -27.4));
float ambientWeather = (ambientMacro - 0.5) * 0.17 + (ambientMeso - 0.5) * 0.10 + (ambientFine - 0.5) * 0.040;
diffuseColor.rgb *= 1.0 + ambientWeather;
float ambientSnowPatch = smoothstep(0.50, 0.81, ambientMeso * 0.70 + ambientFine * 0.30) * ${snowAmount.toFixed(4)};
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.76, 0.81, 0.82), ambientSnowPatch * ${kind === 'stone' ? '0.44' : '0.31'});
float ambientAshPatch = smoothstep(0.42, 0.77, 1.0 - ambientMacro * 0.61 - ambientMeso * 0.39) * ${ashAmount.toFixed(4)};
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.105, 0.095, 0.090), ambientAshPatch * ${kind === 'stone' ? '0.31' : '0.43'});`)
			.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
float ambientNx = ambientPropNoise(ambientPropXZ * 0.91 + vec2(0.17, 0.0)) - ambientPropNoise(ambientPropXZ * 0.91 - vec2(0.17, 0.0));
float ambientNz = ambientPropNoise(ambientPropXZ * 0.91 + vec2(0.0, 0.17)) - ambientPropNoise(ambientPropXZ * 0.91 - vec2(0.0, 0.17));
normal = normalize(normal + mat3(viewMatrix) * vec3(ambientNx, 0.0, ambientNz) * ${normalGain.toFixed(4)});`)
			.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(max(roughnessFactor, ${roughnessBase.toFixed(3)}) + (ambientMeso - 0.5) * 0.13 + (ambientFine - 0.5) * 0.065 + ambientSnowPatch * 0.07 + ambientAshPatch * 0.09, 0.46, 1.0);`);
	};
	material.customProgramCacheKey = () => `${previousCacheKey?.() || ''}|${weatheringShaderKey(kind, snowAmount, ashAmount)}`;
	material.needsUpdate = true;
	return material;
}

function mergeTranslatedBox(width, height, depth, x, y, z) {
	const geometry = new THREE.BoxGeometry(width, height, depth, 1, 1, 1);
	geometry.translate(x, y, z);
	return geometry;
}

/** Low-cost but recognisable geometry used only when a repository GLB cannot be hydrated. */
export function createAmbientFallbackGeometry(familyId) {
	if (familyId === 'barrel') {
		const body = new THREE.CylinderGeometry(0.42, 0.45, 1.0, 12, 3, false);
		body.translate(0, 0.5, 0);
		const upper = new THREE.TorusGeometry(0.43, 0.035, 4, 12);
		upper.rotateX(Math.PI / 2);
		upper.translate(0, 0.83, 0);
		const lower = upper.clone();
		lower.translate(0, -0.65, 0);
		const merged = mergeGeometries([body, upper, lower], false);
		body.dispose();
		upper.dispose();
		lower.dispose();
		merged.computeVertexNormals();
		return merged;
	}
	if (familyId === 'bench') {
		const seat = mergeTranslatedBox(2.4, 0.24, 0.68, 0, 0.83, 0);
		const legA = mergeTranslatedBox(0.34, 0.72, 0.5, -0.72, 0.36, 0);
		const legB = mergeTranslatedBox(0.34, 0.72, 0.5, 0.72, 0.36, 0);
		const merged = mergeGeometries([seat, legA, legB], false);
		seat.dispose();
		legA.dispose();
		legB.dispose();
		merged.computeVertexNormals();
		return merged;
	}
	const box = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
	box.translate(0, 0.5, 0);
	return box;
}

export function createAmbientFallbackMaterial(familyId) {
	const family = SETTLEMENT_AMBIENT_PROP_FAMILIES[familyId];
	if (!family) throw new Error(`Unknown settlement ambient family: ${familyId}`);
	const fabric = createAmbientFallbackFabricTextures(familyId);
	const material = new THREE.MeshStandardMaterial({
		color: family.fallbackColor,
		map: fabric.map,
		roughnessMap: fabric.roughnessMap,
		normalMap: fabric.normalMap,
		normalScale: new THREE.Vector2(familyId === 'bench' ? 0.36 : 0.44, familyId === 'bench' ? 0.36 : 0.44),
		roughness: family.roughnessFloor,
		metalness: 0,
		flatShading: familyId !== 'crate',
	});
	material.userData.settlementAmbientFallbackFabric = true;
	material.userData.settlementAmbientNormalFabric = true;
	applyAmbientPropWorldSpaceWeathering(material, { kind: family.weatheringKind });
	return material;
}

export function placementTintColor(placement) {
	const family = SETTLEMENT_AMBIENT_PROP_FAMILIES[placement.familyId];
	const color = new THREE.Color(family?.fallbackColor ?? 0x777777);
	if (placement.snow > 0.01) color.lerp(new THREE.Color(0xc2cacb), placement.snow * (placement.familyId === 'bench' ? 0.27 : 0.18));
	if (placement.valyria > 0.01) color.lerp(new THREE.Color(0x302b29), placement.valyria * (placement.familyId === 'bench' ? 0.34 : 0.43));
	color.offsetHSL(0, Math.max(-0.055, Math.min(0.055, finite(placement.tintScalar) * 0.18)), Math.max(-0.11, Math.min(0.11, finite(placement.tintScalar))));
	return color;
}

export function collectAmbientRenderableMeshes(model) {
	const meshes = [];
	model?.updateMatrixWorld?.(true);
	model?.traverse?.((node) => {
		if (node?.isMesh && node.geometry?.getAttribute?.('position') && node.material) meshes.push(node);
	});
	return meshes;
}

export function measureAmbientPropAsset(model) {
	model?.updateMatrixWorld?.(true);
	const bounds = new THREE.Box3().setFromObject(model);
	if (bounds.isEmpty()) return null;
	const size = bounds.getSize(new THREE.Vector3());
	const center = bounds.getCenter(new THREE.Vector3());
	const horizontal = Math.max(size.x, size.z);
	const minimum = SETTLEMENT_AMBIENT_PROP_POLICY.sourceExtentEpsilonMeters;
	const aspectRatio = Math.max(size.x, size.y, size.z) / Math.max(minimum, Math.min(size.x, size.y, size.z));
	return Object.freeze({ bounds, size, center, horizontal, aspectRatio });
}

export function validateAmbientPropAsset(model) {
	if (!model || model.userData?.isPlaceholder) return { valid: false, reason: 'placeholder' };
	const meshes = collectAmbientRenderableMeshes(model);
	if (!meshes.length) return { valid: false, reason: 'no-renderable-mesh' };
	if (meshes.length > SETTLEMENT_AMBIENT_PROP_POLICY.maximumHydratedPrimitiveCount) return { valid: false, reason: 'too-many-primitives' };
	const measurement = measureAmbientPropAsset(model);
	if (!measurement) return { valid: false, reason: 'empty-bounds' };
	const numbers = [measurement.size.x, measurement.size.y, measurement.size.z, measurement.horizontal, measurement.aspectRatio];
	if (!numbers.every(Number.isFinite) || measurement.horizontal <= SETTLEMENT_AMBIENT_PROP_POLICY.sourceExtentEpsilonMeters) return { valid: false, reason: 'invalid-bounds' };
	if (measurement.aspectRatio > SETTLEMENT_AMBIENT_PROP_POLICY.maximumSourceAspectRatio) return { valid: false, reason: 'implausible-aspect' };
	return { valid: true, meshes, measurement };
}

function meshWeatheringKind(familyId, mesh) {
	if (familyId === 'bench') return 'stone';
	const label = `${mesh?.name || ''} ${mesh?.material?.name || ''}`.toLowerCase();
	if (/metal|iron|steel|band|hoop/.test(label)) return 'metal';
	return 'wood';
}

export function cloneAmbientModelWithWeatheredMaterials(root, familyId, placement) {
	const clone = root.clone(true);
	clone.traverse((node) => {
		if (!node?.isMesh) return;
		node.castShadow = true;
		node.receiveShadow = true;
		const materials = Array.isArray(node.material) ? node.material : [node.material];
		const clonedMaterials = materials.map((sourceMaterial) => {
			const material = sourceMaterial?.clone?.() || new THREE.MeshStandardMaterial({ color: SETTLEMENT_AMBIENT_PROP_FAMILIES[familyId].fallbackColor });
			if ('color' in material && material.color?.isColor) {
				material.color.lerp(placementTintColor(placement), familyId === 'bench' ? 0.14 : 0.10);
			}
			const kind = meshWeatheringKind(familyId, { name: node.name, material });
			if ('roughness' in material) material.roughness = Math.max(finite(material.roughness, 0.75), kind === 'stone' ? 0.82 : kind === 'metal' ? 0.54 : 0.72);
			if ('metalness' in material && kind !== 'metal') material.metalness = Math.min(finite(material.metalness), 0.08);
			applyAmbientPropWorldSpaceWeathering(material, { kind, snow: placement.snow, ash: placement.valyria });
			return material;
		});
		node.material = Array.isArray(node.material) ? clonedMaterials : clonedMaterials[0];
	});
	return clone;
}

export function disposeAmbientObjectResources(root, { disposeGeometry = false, disposeTextures = false } = {}) {
	const geometries = new Set();
	const materials = new Set();
	const textures = new Set();
	root?.traverse?.((node) => {
		if (disposeGeometry && node?.geometry && !geometries.has(node.geometry)) {
			geometries.add(node.geometry);
			node.geometry.dispose?.();
		}
		for (const material of Array.isArray(node?.material) ? node.material : node?.material ? [node.material] : []) {
			if (!material || materials.has(material)) continue;
			materials.add(material);
			if (disposeTextures) {
				for (const key of Object.keys(material)) {
					const value = material[key];
					if (value?.isTexture && !textures.has(value)) {
						textures.add(value);
						value.dispose?.();
					}
				}
			}
			material.dispose?.();
		}
	});
	return Object.freeze({ geometryCount: geometries.size, materialCount: materials.size, textureCount: textures.size });
}
