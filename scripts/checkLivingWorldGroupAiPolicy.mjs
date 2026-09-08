import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
	LIVING_WORLD_GROUP_AI_POLICY,
	selectGroupLeader,
	computeGroupCenter,
	evaluateGroupCohesion,
	summarizeGroupThreat,
	buildGroupFormationTargets,
	auditGroupAiPolicy,
} from '../src/3d/gameplay/livingWorldGroupAiPolicy.js';

function member(id, x, z, priority = 0, fleeing = false) {
	const object3D = new THREE.Object3D();
	object3D.name = id;
	object3D.position.set(x, 0, z);
	object3D.userData.wildlifeFlee = { direct: fleeing };
	return { id, priority, object3D, isFleeing: fleeing };
}

const members = [
	member('guard-b', 4, 0, 10),
	member('guard-a', 0, 0, 30),
	member('guard-c', 8, 0, 20),
];
const leaderA = selectGroupLeader(members, 'seed');
const leaderB = selectGroupLeader(members, 'seed');
assert.deepEqual(leaderA, leaderB);
assert.equal(leaderA.id, 'guard-a');
const center = computeGroupCenter(members);
assert.equal(center.count, 3);
assert.equal(center.x, 4);
assert.equal(center.z, 0);

const cohesive = evaluateGroupCohesion(members, { cohesionRadiusMeters: 5, leaderId: 'guard-a' });
assert.equal(cohesive.accepted, true);
assert.equal(cohesive.outliers.length, 0);
const stretched = evaluateGroupCohesion([...members, member('guard-distant', 60, 0, 1)], { cohesionRadiusMeters: 10, leaderId: 'guard-a' });
assert.equal(stretched.accepted, false);
assert(stretched.outliers.includes('guard-distant'));

const threat = summarizeGroupThreat(members, [{ x: 2, z: 1 }], { threatRadiusMeters: 5 });
assert.equal(threat.groupIntent, 'investigate');
assert.equal(threat.threatenedMembers, 3);
const fleeGroup = summarizeGroupThreat([member('wolf-a', 0, 0, 0, true), member('wolf-b', 40, 0)], [{ x: 2, z: 0 }], { threatRadiusMeters: 8 });
assert.equal(fleeGroup.groupIntent, 'flee');
assert.equal(fleeGroup.fleeingMembers, 1);

const formationA = buildGroupFormationTargets(members, { leaderId: 'guard-a', separationMeters: 2, seed: 'formation' });
const formationB = buildGroupFormationTargets(members, { leaderId: 'guard-a', separationMeters: 2, seed: 'formation' });
assert.deepEqual(formationA, formationB);
assert.equal(formationA.length, 2);
assert(formationA.every((target) => Number.isFinite(target.targetX) && Number.isFinite(target.targetZ)));

const audit = auditGroupAiPolicy({ members, cohesion: cohesive, threat, formation: formationA });
assert.equal(audit.ok, true);
assert.equal(LIVING_WORLD_GROUP_AI_POLICY.maxMembers, 32);
const overflow = auditGroupAiPolicy({ members: Array.from({ length: 33 }, (_, index) => member(`m-${index}`, index, 0)) });
assert.equal(overflow.ok, false);
assert(overflow.errors.includes('member-overflow'));

console.log(JSON.stringify({ pass: true, leader: leaderA.id, threat: threat.groupIntent, formation: formationA.length }, null, 2));
