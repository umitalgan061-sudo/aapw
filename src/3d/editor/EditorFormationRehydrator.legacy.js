import * as THREE from 'three';

const tempMatrix = new THREE.Matrix4();
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3();
const tempEuler = new THREE.Euler();

function finiteVector3(value, fallback) {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  return value.map((component, index) => Number.isFinite(Number(component)) ? Number(component) : fallback[index]);
}

function bumpGroupCounter(instanceManager, groupId) {
  const match = /-(\d+)$/.exec(String(groupId || ''));
  if (!match) return;
  instanceManager.groupCounter = Math.max(instanceManager.groupCounter, Number(match[1]) + 1);
}

function applySerializedInstances(record, group) {
  if (!Array.isArray(group.instances)) throw new Error(`Instance grubu instances dizisi içermeli: ${group.id || 'adsız'}`);
  if (group.instances.length !== record.instances.length) {
    throw new Error(`Instance sayısı rows×columns ile eşleşmiyor: ${group.id || 'adsız'}`);
  }

  const normalized = group.instances.map((instance, index) => {
    const position = finiteVector3(instance?.position, [0, 0, 0]);
    const rotation = finiteVector3(instance?.rotation, [0, 0, 0]);
    const scale = finiteVector3(instance?.scale, [1, 1, 1]).map((value) => Math.max(0.01, value));
    tempPosition.fromArray(position);
    tempEuler.set(rotation[0], rotation[1], rotation[2]);
    tempQuaternion.setFromEuler(tempEuler);
    tempScale.fromArray(scale);
    tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
    record.object.setMatrixAt(index, tempMatrix);
    return {
      id: instance?.id || `${group.id}-${index}`,
      position,
      rotation,
      scale
    };
  });

  record.object.instanceMatrix.needsUpdate = true;
  record.instances = normalized;
}

export async function rehydrateInstanceGroups(instanceGroups, instanceManager, findAsset) {
  if (!Array.isArray(instanceGroups)) throw new Error('instanceGroups bir dizi olmalı.');
  const createdObjects = [];
  const restored = [];

  try {
    for (const group of instanceGroups) {
      const asset = findAsset(group?.asset);
      if (!asset) continue;
      const rows = Math.max(1, Math.floor(Number(group.rows) || 1));
      const columns = Math.max(1, Math.floor(Number(group.columns) || 1));
      const spacing = Math.max(0.25, Number(group.spacing) || 1.5);
      const record = await instanceManager.createFormation(asset, rows, columns, spacing, new THREE.Vector3());
      createdObjects.push(record.object);
      if (group.id) {
        record.id = group.id;
        record.object.userData.editorInstanceGroupId = group.id;
        bumpGroupCounter(instanceManager, group.id);
      }
      applySerializedInstances(record, group);
      restored.push(record);
    }
    return restored;
  } catch (error) {
    for (const object of createdObjects) instanceManager.removeGroupObject(object);
    throw error;
  }
}
