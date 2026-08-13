/**
 * Procedural creature rigging: builds a real `THREE.Skeleton` and a `THREE.SkinnedMesh` bound to it,
 * generated from a `gameplay/creatureBodyPlans.js` entry rather than loaded from an asset.
 *
 * See `creatureBodyPlans.js`'s module doc for *why* the body is generated: almost none of the
 * animals this project needs have a rigged model, several have no model at all, and downloading
 * real HBO assets is the one thing this project may never do. A generated body sidesteps all of
 * that, and — unlike auto-rigging an arbitrary imported mesh, which is an open research problem —
 * skinning is exact here because the mesh and the skeleton are built together from the same points.
 *
 * **How the skinning works.** Every bone is authored by its bind-pose *world* position and its
 * parent, so a body plan reads as a set of landmarks (hip, shoulder, elbow, hoof) rather than as a
 * chain of local offsets nobody can picture. Each parent→child pair defines a limb segment; the
 * mesh is the union of one tapered tube per segment plus a small sphere at each joint to fill the
 * notch a bend would otherwise open on the outside of the elbow.
 *
 * Weights follow the standard rigging convention: the flesh between joints A and B is driven by
 * bone **A** (rotating A is what swings that segment), blending to a 50/50 share with bone B over
 * the last 40% of the segment so the joint creases smoothly instead of shearing. Joint spheres take
 * the same 50/50 split. Two influences per vertex is enough for limbs and keeps the buffers small.
 *
 * Determinism: no `Math.random()`. Two rigs built from the same plan are geometrically identical;
 * the only per-instance variation is the seeded texture variant, which never touches geometry.
 * @module gameplay/creatureRig
 */

import * as THREE from 'three';
import { findBodyPlan } from './creatureBodyPlans.js';
import { getPaletteMaterial } from '../materials/textureFactory.js';

/** Radial subdivisions around each limb tube. 8 reads as round at gameplay distance and keeps a
 * whole creature near a thousand triangles — see this module's own triangle accounting in
 * `scripts/checkRun326CreatureRig.js`. */
const TUBE_RADIAL_SEGMENTS = 8;
/** Rings along each tube. 4 gives the weight blend below somewhere to actually interpolate; 2 would
 * snap straight from "all parent" to "half child" across a single quad and crease visibly. */
const TUBE_RINGS = 4;
/** Where along a segment the child bone starts taking influence. Before this the parent owns the
 * flesh outright. */
const JOINT_BLEND_START = 0.6;

/**
 * Bind-pose landmark set for one archetype. Each entry is `{name, parent, world:[x,y,z], radius}`
 * with `world` in meters relative to the creature's own origin — which sits on the ground, between
 * the feet, with **+Z forward** (matching the `Math.atan2(dirX, dirZ)` yaw convention `npc.js` and
 * `animals.js` already steer by) and +Y up.
 * @param {import('./creatureBodyPlans.js').CreatureBodyPlan} plan
 * @returns {{name: string, parent: string|null, world: number[], radius: number}[]}
 */
function quadrupedLandmarks(plan) {
	const length = plan.bodyLengthMeters;
	const shoulderY = plan.shoulderHeightMeters;
	const hipY = shoulderY * plan.hindLegLengthFactor;
	const bodyRadius = length * plan.bodyRadiusFactor;
	const legRadius = shoulderY * plan.legThicknessFactor;
	const halfLength = length / 2;
	const trackWidth = bodyRadius * 0.85; // lateral distance from spine to each leg
	// A cranked leg's knee sits forward of the foot and the foot under the hip; `legCrankRadians`
	// scales how far forward, so an elephant's column and a cat's crouch come from one number.
	const crank = Math.sin(plan.legCrankRadians);

	const neckLength = length * plan.neckLengthFactor;
	const neckX = Math.cos(plan.neckPitchRadians) * neckLength;
	const neckY = Math.sin(plan.neckPitchRadians) * neckLength;
	const headLength = length * plan.headLengthFactor;
	const tailLength = length * plan.tailLengthFactor;

	const landmarks = [
		{ name: 'root', parent: null, world: [0, hipY, -halfLength], radius: bodyRadius },
		{ name: 'spine', parent: 'root', world: [0, (hipY + shoulderY) / 2, 0], radius: bodyRadius * 1.05 },
		{ name: 'chest', parent: 'spine', world: [0, shoulderY, halfLength * 0.72], radius: bodyRadius * 0.95 },
		{
			name: 'neck',
			parent: 'chest',
			world: [0, shoulderY + neckY * 0.55, halfLength * 0.72 + neckX * 0.55],
			radius: bodyRadius * 0.5,
		},
		{
			name: 'head',
			parent: 'neck',
			world: [0, shoulderY + neckY, halfLength * 0.72 + neckX],
			radius: bodyRadius * 0.62,
		},
		{
			name: 'muzzle',
			parent: 'head',
			world: [
				0,
				shoulderY + neckY - Math.sin(plan.neckPitchRadians) * headLength * 0.35,
				halfLength * 0.72 + neckX + Math.cos(plan.neckPitchRadians * 0.35) * headLength,
			],
			radius: bodyRadius * 0.3,
		},
	];

	if (tailLength > 0) {
		landmarks.push(
			{ name: 'tailBase', parent: 'root', world: [0, hipY, -halfLength - tailLength * 0.5], radius: bodyRadius * plan.tailThicknessFactor },
			{ name: 'tailTip', parent: 'tailBase', world: [0, hipY - tailLength * 0.25, -halfLength - tailLength], radius: bodyRadius * plan.tailThicknessFactor * 0.35 },
		);
	}
	if (plan.earSizeFactor > 0) {
		const earLength = headLength * plan.earSizeFactor;
		// Ears grow out of the head along their own pitch: near-vertical for a pricked cat or rabbit,
		// near-horizontal for an elephant's lateral fan. A fixed vertical offset made every species
		// sprout the same pair of spikes, which read as horns rather than ears.
		const earRise = Math.sin(plan.earPitchRadians) * earLength;
		const earSpread = Math.cos(plan.earPitchRadians) * earLength;
		for (const [suffix, side] of [['L', 1], ['R', -1]]) {
			landmarks.push({
				name: `ear${suffix}`,
				parent: 'head',
				world: [
					side * (bodyRadius * 0.38 + earSpread),
					shoulderY + neckY + earRise,
					halfLength * 0.72 + neckX - earLength * 0.15,
				],
				radius: bodyRadius * 0.12 + earSpread * 0.18,
			});
		}
	}

	// Four legs. Hind legs hang from `root` (the hip), fore legs from `chest` (the shoulder), which
	// is what makes a gait's diagonal pairs actually move the right ends of the animal.
	for (const [suffix, side] of [['L', 1], ['R', -1]]) {
		for (const [prefix, attach, topY, topZ] of [
			['hind', 'root', hipY, -halfLength],
			['fore', 'chest', shoulderY, halfLength * 0.72],
		]) {
			const legLength = topY;
			landmarks.push(
				{
					name: `${prefix}Knee${suffix}`,
					parent: attach,
					world: [side * trackWidth, legLength * 0.52, topZ + crank * legLength * 0.22 * (prefix === 'hind' ? -1 : 1)],
					radius: legRadius,
				},
				{
					name: `${prefix}Ankle${suffix}`,
					parent: `${prefix}Knee${suffix}`,
					world: [side * trackWidth, legLength * 0.16, topZ],
					radius: legRadius * 0.8,
				},
				{
					name: `${prefix}Foot${suffix}`,
					parent: `${prefix}Ankle${suffix}`,
					world: [side * trackWidth, legRadius * 0.9, topZ + legRadius * 1.2],
					radius: legRadius * 0.9,
				},
			);
		}
	}
	return landmarks;
}

/** @see quadrupedLandmarks — same contract, two legs plus arms and no tail. */
function bipedLandmarks(plan) {
	const torsoLength = plan.bodyLengthMeters;
	const shoulderY = plan.shoulderHeightMeters;
	const hipY = shoulderY - torsoLength;
	const bodyRadius = torsoLength * plan.bodyRadiusFactor;
	const limbRadius = shoulderY * plan.legThicknessFactor;
	const neckLength = torsoLength * plan.neckLengthFactor;
	const headLength = torsoLength * plan.headLengthFactor;
	const hipWidth = bodyRadius * 0.55;
	const shoulderWidth = bodyRadius * 1.05;
	const crank = Math.sin(plan.legCrankRadians);

	const landmarks = [
		{ name: 'root', parent: null, world: [0, hipY, 0], radius: bodyRadius * 0.9 },
		{ name: 'spine', parent: 'root', world: [0, hipY + torsoLength * 0.5, 0], radius: bodyRadius * 0.85 },
		{ name: 'chest', parent: 'spine', world: [0, shoulderY, 0], radius: bodyRadius },
		{ name: 'neck', parent: 'chest', world: [0, shoulderY + neckLength, 0], radius: bodyRadius * 0.35 },
		{ name: 'head', parent: 'neck', world: [0, shoulderY + neckLength + headLength * 0.55, 0], radius: headLength * 0.45 },
	];
	for (const [suffix, side] of [['L', 1], ['R', -1]]) {
		landmarks.push(
			{ name: `hindKnee${suffix}`, parent: 'root', world: [side * hipWidth, hipY * 0.52, crank * hipY * 0.1], radius: limbRadius },
			{ name: `hindAnkle${suffix}`, parent: `hindKnee${suffix}`, world: [side * hipWidth, hipY * 0.08, 0], radius: limbRadius * 0.75 },
			{ name: `hindFoot${suffix}`, parent: `hindAnkle${suffix}`, world: [side * hipWidth, limbRadius * 0.8, limbRadius * 2.2], radius: limbRadius * 0.8 },
			{ name: `foreKnee${suffix}`, parent: 'chest', world: [side * shoulderWidth, shoulderY - torsoLength * 0.42, 0], radius: limbRadius * 0.85 },
			{ name: `foreAnkle${suffix}`, parent: `foreKnee${suffix}`, world: [side * shoulderWidth, shoulderY - torsoLength * 0.82, 0], radius: limbRadius * 0.7 },
			{ name: `foreFoot${suffix}`, parent: `foreAnkle${suffix}`, world: [side * shoulderWidth, shoulderY - torsoLength * 0.95, 0], radius: limbRadius * 0.7 },
		);
	}
	return landmarks;
}

/** @see quadrupedLandmarks — a compact body on two legs, with folded wings instead of arms. */
function birdLandmarks(plan) {
	const length = plan.bodyLengthMeters;
	const standY = plan.shoulderHeightMeters;
	const bodyRadius = length * plan.bodyRadiusFactor;
	const legRadius = standY * plan.legThicknessFactor;
	const neckLength = length * plan.neckLengthFactor;
	const headLength = length * plan.headLengthFactor;
	const tailLength = length * plan.tailLengthFactor;
	const bodyY = standY + bodyRadius;
	const crank = Math.sin(plan.legCrankRadians);

	const landmarks = [
		{ name: 'root', parent: null, world: [0, bodyY, -length * 0.15], radius: bodyRadius },
		{ name: 'spine', parent: 'root', world: [0, bodyY + bodyRadius * 0.15, length * 0.12], radius: bodyRadius * 0.95 },
		{ name: 'chest', parent: 'spine', world: [0, bodyY + bodyRadius * 0.25, length * 0.3], radius: bodyRadius * 0.7 },
		{
			name: 'neck',
			parent: 'chest',
			world: [0, bodyY + bodyRadius * 0.25 + Math.sin(plan.neckPitchRadians) * neckLength, length * 0.3 + Math.cos(plan.neckPitchRadians) * neckLength],
			radius: bodyRadius * 0.3,
		},
		{
			name: 'head',
			parent: 'neck',
			world: [0, bodyY + bodyRadius * 0.25 + Math.sin(plan.neckPitchRadians) * neckLength + headLength * 0.4, length * 0.3 + Math.cos(plan.neckPitchRadians) * neckLength + headLength * 0.3],
			radius: bodyRadius * 0.34,
		},
		{ name: 'tailBase', parent: 'root', world: [0, bodyY, -length * 0.15 - tailLength * 0.5], radius: bodyRadius * plan.tailThicknessFactor },
		{ name: 'tailTip', parent: 'tailBase', world: [0, bodyY - tailLength * 0.1, -length * 0.15 - tailLength], radius: bodyRadius * plan.tailThicknessFactor * 0.4 },
	];
	for (const [suffix, side] of [['L', 1], ['R', -1]]) {
		landmarks.push(
			{ name: `hindKnee${suffix}`, parent: 'root', world: [side * bodyRadius * 0.45, bodyY * 0.5, -length * 0.15 + crank * bodyY * 0.12], radius: legRadius },
			{ name: `hindAnkle${suffix}`, parent: `hindKnee${suffix}`, world: [side * bodyRadius * 0.45, bodyY * 0.14, -length * 0.15], radius: legRadius * 0.8 },
			{ name: `hindFoot${suffix}`, parent: `hindAnkle${suffix}`, world: [side * bodyRadius * 0.45, legRadius * 0.9, -length * 0.15 + legRadius * 3], radius: legRadius * 0.9 },
			// Folded wings: a flat blade along the flank, which the flap gait swings out and down.
			{ name: `wing${suffix}`, parent: 'chest', world: [side * bodyRadius * 1.05, bodyY + bodyRadius * 0.1, -length * 0.05], radius: bodyRadius * 0.42 },
			{ name: `wingTip${suffix}`, parent: `wing${suffix}`, world: [side * bodyRadius * 1.3, bodyY - bodyRadius * 0.1, -length * 0.3], radius: bodyRadius * 0.18 },
		);
	}
	return landmarks;
}

const LANDMARK_BUILDERS = {
	quadruped: quadrupedLandmarks,
	biped: bipedLandmarks,
	bird: birdLandmarks,
};

/**
 * Appends one tapered tube (plus the sphere that fills its distal joint) to the accumulating
 * buffers, in bind-pose world space, with the two-influence weights described in the module doc.
 */
function appendSegment(buffers, from, to, boneIndexParent, boneIndexChild, vParameterStart, vParameterEnd) {
	const { positions, normals, uvs, skinIndices, skinWeights, indices } = buffers;
	const axis = new THREE.Vector3().subVectors(to.position, from.position);
	const segmentLength = axis.length() || 1e-5;
	axis.divideScalar(segmentLength);
	// Any vector not parallel to the axis works as a seed for the perpendicular frame; picking the
	// world up-axis unless the segment is itself near-vertical keeps the UV seam off the animal's
	// visible flank for horizontal bones and off its front for legs.
	const seed = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
	const sideways = new THREE.Vector3().crossVectors(seed, axis).normalize();
	const upward = new THREE.Vector3().crossVectors(axis, sideways).normalize();

	const baseVertex = positions.length / 3;
	for (let ring = 0; ring < TUBE_RINGS; ring++) {
		const t = ring / (TUBE_RINGS - 1);
		const centre = new THREE.Vector3().copy(from.position).addScaledVector(axis, segmentLength * t);
		const radius = from.radius + (to.radius - from.radius) * t;
		// Standard rigging convention: this flesh belongs to the parent bone, easing to a shared
		// influence with the child over the last stretch so the joint creases instead of shearing.
		const childShare = t <= JOINT_BLEND_START ? 0 : ((t - JOINT_BLEND_START) / (1 - JOINT_BLEND_START)) * 0.5;
		for (let radial = 0; radial <= TUBE_RADIAL_SEGMENTS; radial++) {
			const angle = (radial / TUBE_RADIAL_SEGMENTS) * Math.PI * 2;
			const normal = new THREE.Vector3()
				.addScaledVector(sideways, Math.cos(angle))
				.addScaledVector(upward, Math.sin(angle));
			positions.push(centre.x + normal.x * radius, centre.y + normal.y * radius, centre.z + normal.z * radius);
			normals.push(normal.x, normal.y, normal.z);
			uvs.push(radial / TUBE_RADIAL_SEGMENTS, vParameterStart + (vParameterEnd - vParameterStart) * t);
			skinIndices.push(boneIndexParent, boneIndexChild, 0, 0);
			skinWeights.push(1 - childShare, childShare, 0, 0);
		}
	}
	const ringStride = TUBE_RADIAL_SEGMENTS + 1;
	for (let ring = 0; ring < TUBE_RINGS - 1; ring++) {
		for (let radial = 0; radial < TUBE_RADIAL_SEGMENTS; radial++) {
			const a = baseVertex + ring * ringStride + radial;
			const b = a + ringStride;
			indices.push(a, b, a + 1, b, b + 1, a + 1);
		}
	}
}

/** Low-poly sphere at a joint, filling the notch a bend opens on the outside of an elbow. */
function appendJointSphere(buffers, joint, boneIndexParent, boneIndexChild, vParameter) {
	const { positions, normals, uvs, skinIndices, skinWeights, indices } = buffers;
	const rings = 4;
	const radials = TUBE_RADIAL_SEGMENTS;
	const baseVertex = positions.length / 3;
	for (let ring = 0; ring <= rings; ring++) {
		const phi = (ring / rings) * Math.PI;
		for (let radial = 0; radial <= radials; radial++) {
			const theta = (radial / radials) * Math.PI * 2;
			const nx = Math.sin(phi) * Math.cos(theta);
			const ny = Math.cos(phi);
			const nz = Math.sin(phi) * Math.sin(theta);
			positions.push(joint.position.x + nx * joint.radius, joint.position.y + ny * joint.radius, joint.position.z + nz * joint.radius);
			normals.push(nx, ny, nz);
			uvs.push(radial / radials, vParameter);
			skinIndices.push(boneIndexParent, boneIndexChild, 0, 0);
			skinWeights.push(0.5, 0.5, 0, 0);
		}
	}
	const ringStride = radials + 1;
	for (let ring = 0; ring < rings; ring++) {
		for (let radial = 0; radial < radials; radial++) {
			const a = baseVertex + ring * ringStride + radial;
			const b = a + ringStride;
			indices.push(a, b, a + 1, b, b + 1, a + 1);
		}
	}
}

/**
 * Builds a species' skeleton and the skinned body bound to it.
 *
 * @param {object} options
 * @param {string} options.speciesId Key into `CREATURE_BODY_PLANS`.
 * @param {string} [options.variant] Seed string for the procedural hide texture. Geometry is
 *   unaffected — two creatures of a species differ in coat, never in build.
 * @param {number} [options.textureSize]
 * @returns {{object3D: THREE.Group, skinnedMesh: THREE.SkinnedMesh, skeleton: THREE.Skeleton, bones: Record<string, THREE.Bone>, plan: import('./creatureBodyPlans.js').CreatureBodyPlan, triangleCount: number, dispose: () => void}}
 *   `object3D` is what the caller adds to the scene; its origin sits on the ground between the feet
 *   with +Z forward, so existing ground-snapping code (`groundCollider.getGroundHeight`) can drive
 *   `object3D.position.y` directly with no per-species offset.
 */
export function createCreatureRig({ speciesId, variant = '', textureSize }) {
	const plan = findBodyPlan(speciesId);
	const landmarks = LANDMARK_BUILDERS[plan.archetype](plan);

	const byName = new Map();
	for (const landmark of landmarks) byName.set(landmark.name, landmark);
	const boneIndexByName = new Map();
	landmarks.forEach((landmark, index) => boneIndexByName.set(landmark.name, index));
	for (const landmark of landmarks) {
		if (landmark.parent && !byName.has(landmark.parent)) {
			throw new Error(`[gameplay/creatureRig] ${plan.id}: landmark "${landmark.name}" names unknown parent "${landmark.parent}"`);
		}
	}

	// --- skinned surface, one tube per parent→child pair --------------------------------------
	const buffers = { positions: [], normals: [], uvs: [], skinIndices: [], skinWeights: [], indices: [] };
	let vParameter = 0;
	for (const landmark of landmarks) {
		if (!landmark.parent) continue;
		const parent = byName.get(landmark.parent);
		const parentIndex = boneIndexByName.get(landmark.parent);
		const childIndex = boneIndexByName.get(landmark.name);
		const from = { position: new THREE.Vector3(...parent.world), radius: parent.radius };
		const to = { position: new THREE.Vector3(...landmark.world), radius: landmark.radius };
		appendSegment(buffers, from, to, parentIndex, childIndex, vParameter, vParameter + 0.25);
		appendJointSphere(buffers, to, parentIndex, childIndex, vParameter + 0.25);
		vParameter = (vParameter + 0.25) % 1;
	}

	// --- plant the bind pose exactly on the ground ---------------------------------------------
	// Measured off the finished surface rather than assumed from a landmark: the lowest point of a
	// foot is the *tube* wrapped around a near-horizontal ankle-to-toe axis, which sits lower than
	// either endpoint's sphere. Shifting landmarks and vertices by the same measured amount makes
	// "the soles touch y=0" true by construction for every archetype, including any plan added later.
	let lowestY = Infinity;
	for (let i = 1; i < buffers.positions.length; i += 3) lowestY = Math.min(lowestY, buffers.positions[i]);
	const groundOffset = Number.isFinite(lowestY) ? lowestY : 0;
	if (groundOffset !== 0) {
		for (let i = 1; i < buffers.positions.length; i += 3) buffers.positions[i] -= groundOffset;
		for (const landmark of landmarks) landmark.world[1] -= groundOffset;
	}

	// --- bones, authored by bind-pose world position, converted to local offsets ---------------
	const bones = [];
	const boneByName = {};
	for (const landmark of landmarks) {
		const bone = new THREE.Bone();
		bone.name = landmark.name;
		const parent = landmark.parent ? byName.get(landmark.parent) : null;
		bone.position.set(
			landmark.world[0] - (parent ? parent.world[0] : 0),
			landmark.world[1] - (parent ? parent.world[1] : 0),
			landmark.world[2] - (parent ? parent.world[2] : 0),
		);
		bones.push(bone);
		boneByName[landmark.name] = bone;
	}
	for (const landmark of landmarks) {
		if (landmark.parent) boneByName[landmark.parent].add(boneByName[landmark.name]);
	}
	const rootBone = boneByName[landmarks[0].name];
	rootBone.updateMatrixWorld(true); // Skeleton derives its bone inverses from these world matrices.

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
	geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
	geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(buffers.skinIndices, 4));
	geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(buffers.skinWeights, 4));
	geometry.setIndex(buffers.indices);
	geometry.computeBoundingSphere();

	const material = getPaletteMaterial(plan.paletteId, {
		variant: variant || plan.id,
		...(textureSize ? { size: textureSize } : {}),
	});
	const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
	skinnedMesh.name = `${plan.id}-body`;
	skinnedMesh.castShadow = true;

	const skeleton = new THREE.Skeleton(bones);
	const object3D = new THREE.Group();
	object3D.name = plan.id;
	object3D.add(rootBone);
	object3D.add(skinnedMesh);
	skinnedMesh.bind(skeleton);

	return {
		object3D,
		skinnedMesh,
		skeleton,
		bones: boneByName,
		plan,
		triangleCount: buffers.indices.length / 3,
		/** Releases geometry and skeleton. The material comes from `textureFactory`'s shared cache
		 * and is deliberately **not** disposed here — other creatures of the same species are using
		 * the very same instance. `disposePaletteCaches()` is the owner of that lifetime. */
		dispose() {
			geometry.dispose();
			skeleton.dispose();
		},
	};
}
