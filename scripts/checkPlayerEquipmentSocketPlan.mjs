import assert from 'node:assert/strict';
import { buildPlayerEquipmentSocketPlan, serializePlayerEquipmentSocketPlan } from '../src/3d/gameplay/playerEquipmentSocketPlan.js';

const profile = {
  sockets: { mainHand: { id: 'arming-sword', assetUrl: 'assets/models/props/arming-sword.glb', materialFamily: 'metal' } },
  equipment: { chest: { id: 'leather', assetUrl: 'assets/models/props/leather-armor.glb', materialFamily: 'leather' } },
};
const skeletonNodes = ['mixamorig:Head', 'mixamorig:Spine2', 'mixamorig:RightHand', 'mixamorig:LeftHand', 'mixamorig:Spine'];

const planA = buildPlayerEquipmentSocketPlan({ profile, skeletonNodes });
const planB = buildPlayerEquipmentSocketPlan({ profile, skeletonNodes });
assert.deepEqual(planA, planB, 'socket plan must be deterministic');
assert.equal(planA.placements.find((item) => item.slot === 'mainHand').socket.name, 'mixamorig:RightHand');
assert.equal(planA.placements.find((item) => item.slot === 'chest').socket.name, 'mixamorig:Spine2');
assert.equal(planA.validation.placeholderGeometryAllowed, false);
assert.equal(planA.validation.editorMaterialStudioImported, false);
assert.equal(planA.validation.missingAssetCount, 0);
assert.equal(Object.isFrozen(planA), true);
assert.equal(serializePlayerEquipmentSocketPlan(planA), serializePlayerEquipmentSocketPlan(planB));

const fallback = buildPlayerEquipmentSocketPlan({
  equipment: { offHand: { id: 'shield', assetUrl: 'assets/models/props/shield.glb', socket: 'missing-bone' } },
  skeletonNodes: [],
});
assert.equal(fallback.skeleton.unresolvedSlots.includes('offHand'), true);
assert.equal(fallback.placements[0].socket.source, 'fallback');
assert.equal(fallback.placements[0].materialContract.requiresValidation, true);

const malformed = buildPlayerEquipmentSocketPlan({ equipment: { mainHand: { assetUrl: '' } }, skeletonNodes: [null, 4, ''] });
assert.equal(malformed.validation.missingAssetCount, 1);
assert.equal(malformed.placements[0].id, 'empty-mainhand');

console.log('PLAYER_EQUIPMENT_SOCKET_PLAN PASS');
