import assert from 'node:assert/strict';
import * as THREE from '../src/3d/vendor/three/three.module.js';
import {
	LIVING_WORLD_GROUP_DIRECTOR_POLICY,
	buildGroupDirective,
	createGroupDirectorSnapshot,
	groupDirectorDigest,
	auditGroupDirectorSnapshot,
} from '../src/3d/gameplay/livingWorldGroupDirectorAdapter.js';

function member(id, x, z, priority = 0, fleeing = false) {
	const object3D = new THREE.Object3D();
	object3D.name = id;
	object3D.position.set(x, 0, z);
	object3D.userData.wildlifeFlee = { direct: fleeing };
	return { id, priority, object3D, isFleeing: fleeing };
}

const members = [member('leader', 0, 0, 30), member('wing-a', 3, 1, 10), member('wing-b', -2, 2, 8)];
const directive = buildGroupDirective({
	id: 'guard-group',
	members,
	threatPositions: [{ x: 2, z: 2 }],
	seed: 'group-seed',
	cohesionRadiusMeters: 8,
	threatRadiusMeters: 5,
	separationMeters: 2,
});
assert.equal(directive.accepted, true);
assert.equal(directive.leader.id, 'leader');
assert.equal(directive.intent, 'investigate');
assert.equal(directive.directive, 'converge-on-contact');
assert.equal(directive.formation.length, 2);
assert.equal(auditGroupDirectorSnapshot(createGroupDirectorSnapshot([{ id: 'guard-group', members, threatPositions: [{ x: 2, z: 2 }], seed: 'group-seed' }])).ok, true);

const fleeDirective = buildGroupDirective({
	id: 'wolf-pack',
	members: [member('wolf-a', 0, 0, 3, true), member('wolf-b', 40, 0, 2)],
	threatPositions: [{ x: 2, z: 0 }],
	seed: 'wolf-seed',
});
assert.equal(fleeDirective.intent, 'flee');
assert.equal(fleeDirective.directive, 'disperse-from-threat');

const empty = buildGroupDirective({ id: 'empty', members: [], seed: 'empty' });
assert.equal(empty.accepted, false);
const snapshotA = createGroupDirectorSnapshot([
	{ id: 'g1', members, threatPositions: [{ x: 2, z: 2 }], seed: 'one' },
	{ id: 'g2', members: members.slice(1), threatPositions: [], seed: 'two' },
]);
const snapshotB = createGroupDirectorSnapshot([
	{ id: 'g1', members, threatPositions: [{ x: 2, z: 2 }], seed: 'one' },
	{ id: 'g2', members: members.slice(1), threatPositions: [], seed: 'two' },
]);
assert.deepEqual(snapshotA, snapshotB);
assert.equal(groupDirectorDigest(snapshotA), groupDirectorDigest(snapshotB));
assert.equal(snapshotA.groupCount, 2);
assert.equal(snapshotA.acceptedGroups, 2);
assert.equal(LIVING_WORLD_GROUP_DIRECTOR_POLICY.maxGroups, 24);

console.log(JSON.stringify({
	pass: true,
	intent: directive.intent,
	fleeDirective: fleeDirective.directive,
	groups: snapshotA.groupCount,
	digest: groupDirectorDigest(snapshotA),
}, null, 2));
