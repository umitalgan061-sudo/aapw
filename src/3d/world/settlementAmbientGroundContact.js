/**
 * Render-only ground-contact dressing for settlement ambient props.
 *
 * Small props otherwise read as objects placed on top of terrain rather than objects that have sat
 * there for months. This layer adds subtle compacted-earth, snow-crust or ash contact patches under
 * the already-approved prop positions. It samples the same collider-owned height function only to
 * align the patch normal; it never deforms terrain, changes hydrology, adds collision or invents a
 * new geographic anchor.
 * @module world/settlementAmbientGroundContact
 */

import * as THREE from 'three';
import { sampleAmbientPropTerrainFrame } from './settlementAmbientPlacement.js';

export const SETTLEMENT_AMBIENT_GROUND_CONTACT_POLICY = Object.freeze({
	id: 'settlement-ambient-ground-contact-2026-09-02-v1-climate-grounding',
	renderOnly: true,
	canonicalTerrainUnchanged: true,
	canonicalHydrologyUnchanged: true,
	canonicalCollidersUnchanged: true,
	contactOffsetMeters: 0.035,
	textureSize: 64,
	segments: 20,
	minimumScaleMeters: 0.78,
	maximumScaleMeters: 2.55,
	groupName: 'settlement-ambient-ground-contact',
});

const CLIMATE_BUCKETS = Object.freeze(['temperate', 'snow', 'ash']);
const tempObject = new THREE.Object3D();
const tempMatrix = new THREE.Matrix4();
const up = new THREE.Vector3(0, 1, 0);
const normal = new THREE.Vector3();
const color = new THREE.Color();

function clamp01(value) {
	return Math.max(0, Math.min(1, value));
}

function hash01(x, y, seed) {
	let value = Math.imul((x + 13) ^ seed, 0x45d9f3b) ^ Math.imul((y + 29) ^ (seed >>> 2), 0x27d4eb2d);
	value ^= value >>> 16;
	value = Math.imul(value, 0x45d9f3b);
	value ^= value >>> 15;
	return (value >>> 0) / 4294967295;
}

function climateBucket(placement) {
	if (placement.snow >= 0.25 && placement.snow >= placement.valyria) return 'snow';
	if (placement.valyria >= 0.25) return 'ash';
	return 'temperate';
}

function contactRadiusMeters(placement) {
	const familyBase = placement.familyId === 'bench' ? 1.22 : placement.familyId === 'crate' ? 0.72 : 0.62;
	const climateSpread = climateBucket(placement) === 'snow' ? 1.14 : climateBucket(placement) === 'ash' ? 1.08 : 1;
	return Math.max(
		SETTLEMENT_AMBIENT_GROUND_CONTACT_POLICY.minimumScaleMeters,
		Math.min(
			SETTLEMENT_AMBIENT_GROUND_CONTACT_POLICY.maximumScaleMeters,
			familyBase * Number(placement.scale || 1) * climateSpread,
		),
	);
}

function createContactTexture(bucket) {
	const size = SETTLEMENT_AMBIENT_GROUND_CONTACT_POLICY.textureSize;
	const data = new Uint8Array(size * size * 4);
	const seed = bucket === 'snow' ? 0x534e4f57 : bucket === 'ash' ? 0x41534821 : 0x45415254;
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const index = (y * size + x) * 4;
			const nx = (x + 0.5) / size * 2 - 1;
			const ny = (y + 0.5) / size * 2 - 1;
			const angle = Math.atan2(ny, nx);
			const radial = Math.hypot(nx, ny);
			const broad = hash01(Math.floor(x / 7), Math.floor(y / 7), seed);
			const medium = hash01(Math.floor(x / 3), Math.floor(y / 3), seed ^ 0x5f3759df);
			const fine = hash01(x, y, seed ^ 0x7f4a7c15);
			const edgeWarp = (broad - 0.5) * 0.17 + Math.sin(angle * 5 + medium * 3.1) * 0.055;
			const edge = 0.94 + edgeWarp;
			const radialMask = 1 - clamp01((radial - (edge - 0.30)) / 0.30);
			const breakup = clamp01(0.64 + (broad - 0.5) * 0.38 + (medium - 0.5) * 0.28 + (fine - 0.5) * 0.12);
			const alpha = clamp01(radialMask * breakup);
			const value = bucket === 'snow'
				? Math.round(198 + breakup * 39)
				: bucket === 'ash'
					? Math.round(58 + breakup * 31)
					: Math.round(104 + breakup * 48);
			data[index] = value;
			data[index + 1] = bucket === 'temperate' ? Math.round(value * 0.82) : bucket === 'snow' ? Math.round(value * 0.99) : Math.round(value * 0.93);
			data[index + 2] = bucket === 'temperate' ? Math.round(value * 0.61) : bucket === 'snow' ? Math.min(255, value + 5) : Math.round(value * 0.88);
			data[index + 3] = Math.round(alpha * 255);
		}
	}
	const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.needsUpdate = true;
	texture.userData.settlementAmbientGroundContact = true;
	texture.userData.climateBucket = bucket;
	return texture;
}

function createContactMaterial(bucket) {
	const map = createContactTexture(bucket);
	const material = new THREE.MeshStandardMaterial({
		color: 0xffffff,
		map,
		transparent: true,
		opacity: bucket === 'snow' ? 0.44 : bucket === 'ash' ? 0.34 : 0.28,
		alphaTest: 0.035,
		depthWrite: false,
		roughness: bucket === 'snow' ? 0.91 : 0.98,
		metalness: 0,
		polygonOffset: true,
		polygonOffsetFactor: -1,
		polygonOffsetUnits: -1,
	});
	material.userData.settlementAmbientGroundContact = true;
	material.userData.climateBucket = bucket;
	return material;
}

function createContactGeometry() {
	const geometry = new THREE.CircleGeometry(1, SETTLEMENT_AMBIENT_GROUND_CONTACT_POLICY.segments);
	geometry.rotateX(-Math.PI / 2);
	return geometry;
}

function contactTint(placement, bucket) {
	if (bucket === 'snow') {
		color.setRGB(0.86, 0.90, 0.91);
		color.lerp(new THREE.Color(0xc6d1d4), clamp01(placement.snow) * 0.42);
	} else if (bucket === 'ash') {
		color.setRGB(0.36, 0.32, 0.29);
		color.lerp(new THREE.Color(0x2b2928), clamp01(placement.valyria) * 0.52);
	} else {
		color.setRGB(0.68, 0.55, 0.39);
		color.offsetHSL(0, 0, (Number(placement.tintScalar) || 0) * 0.22);
	}
	return color.clone();
}

function composeContactMatrix(placement, sampleHeightMeters) {
	const frame = sampleAmbientPropTerrainFrame(sampleHeightMeters, placement.x, placement.z);
	normal.set(-frame.gradientX, 1, -frame.gradientZ).normalize();
	tempObject.position.set(
		placement.x,
		frame.height + SETTLEMENT_AMBIENT_GROUND_CONTACT_POLICY.contactOffsetMeters,
		placement.z,
	);
	tempObject.quaternion.setFromUnitVectors(up, normal);
	// Rotation around local terrain normal prevents a repeated contact-patch orientation while keeping
	// the patch exactly tangent to the same sampled slope used by the prop placement gate.
	const yaw = ((placement.id.length * 0.61803398875 + placement.variation * 7.1) % 1) * Math.PI * 2;
	const yawQuaternion = new THREE.Quaternion().setFromAxisAngle(normal, yaw);
	tempObject.quaternion.premultiply(yawQuaternion);
	const radius = contactRadiusMeters(placement);
	const eccentricity = placement.familyId === 'bench' ? 1.36 : placement.familyId === 'crate' ? 1.12 : 1.0;
	tempObject.scale.set(radius * eccentricity, 1, radius);
	tempObject.updateMatrix();
	return tempMatrix.copy(tempObject.matrix);
}

function createContactMesh(bucket, placements, sampleHeightMeters) {
	if (!placements.length) return null;
	const mesh = new THREE.InstancedMesh(createContactGeometry(), createContactMaterial(bucket), placements.length);
	mesh.name = `settlement-ambient-contact-${bucket}`;
	mesh.castShadow = false;
	mesh.receiveShadow = true;
	mesh.renderOrder = -0.25;
	mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
	placements.forEach((placement, index) => {
		mesh.setMatrixAt(index, composeContactMatrix(placement, sampleHeightMeters));
		mesh.setColorAt(index, contactTint(placement, bucket));
	});
	mesh.instanceMatrix.needsUpdate = true;
	if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	mesh.computeBoundingSphere?.();
	mesh.userData.settlementAmbientGroundContact = true;
	mesh.userData.preserveShadowRole = true;
	mesh.userData.climateBucket = bucket;
	mesh.userData.placementIds = placements.map((placement) => placement.id);
	return mesh;
}

export function createSettlementAmbientGroundContacts(placements, { sampleHeightMeters } = {}) {
	const group = new THREE.Group();
	group.name = SETTLEMENT_AMBIENT_GROUND_CONTACT_POLICY.groupName;
	if (!Array.isArray(placements) || typeof sampleHeightMeters !== 'function') {
		group.userData.settlementAmbientGroundContact = Object.freeze({
			policyId: SETTLEMENT_AMBIENT_GROUND_CONTACT_POLICY.id,
			placementCount: 0,
			drawCalls: 0,
			status: 'disabled-missing-surface',
		});
		return Object.freeze({ group, stats: group.userData.settlementAmbientGroundContact });
	}

	const meshes = [];
	const bucketCounts = Object.fromEntries(CLIMATE_BUCKETS.map((bucket) => [bucket, 0]));
	for (const bucket of CLIMATE_BUCKETS) {
		const bucketPlacements = placements.filter((placement) => climateBucket(placement) === bucket);
		bucketCounts[bucket] = bucketPlacements.length;
		const mesh = createContactMesh(bucket, bucketPlacements, sampleHeightMeters);
		if (mesh) meshes.push(mesh);
	}
	group.add(...meshes);
	const stats = Object.freeze({
		policyId: SETTLEMENT_AMBIENT_GROUND_CONTACT_POLICY.id,
		placementCount: placements.length,
		drawCalls: meshes.length,
		bucketCounts: Object.freeze(bucketCounts),
		status: 'active',
	});
	group.userData.settlementAmbientGroundContact = stats;
	return Object.freeze({ group, stats });
}

export function disposeSettlementAmbientGroundContacts(group) {
	if (!group) return;
	const geometries = new Set();
	const materials = new Set();
	const textures = new Set();
	group.traverse((node) => {
		if (node?.geometry && !geometries.has(node.geometry)) {
			geometries.add(node.geometry);
			node.geometry.dispose?.();
		}
		for (const material of Array.isArray(node?.material) ? node.material : node?.material ? [node.material] : []) {
			if (!material || materials.has(material)) continue;
			materials.add(material);
			for (const key of Object.keys(material)) {
				const value = material[key];
				if (value?.isTexture && !textures.has(value)) {
					textures.add(value);
					value.dispose?.();
				}
			}
			material.dispose?.();
		}
	});
	group.clear();
}
