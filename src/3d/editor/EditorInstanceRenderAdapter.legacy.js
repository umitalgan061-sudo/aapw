function assertThreeNamespace(THREE) {
  const required = ['Matrix4', 'Vector3', 'Quaternion', 'Euler'];
  for (const key of required) {
    if (typeof THREE?.[key] !== 'function') throw new TypeError(`THREE.${key} constructor is required`);
  }
}

function assertRecord(record, instanceIndex) {
  if (!record?.object || typeof record.object.setMatrixAt !== 'function') throw new TypeError('record.object must be an InstancedMesh-compatible object');
  if (!Array.isArray(record.instances)) throw new TypeError('record.instances must be an array');
  if (!Number.isInteger(instanceIndex) || instanceIndex < 0 || instanceIndex >= record.instances.length) {
    throw new RangeError(`instanceIndex out of bounds: ${instanceIndex}`);
  }
  if (!record.object.instanceMatrix) throw new TypeError('record.object.instanceMatrix is required');
}

export function applyInstanceTransformToMesh(THREE, record, instanceIndex) {
  assertThreeNamespace(THREE);
  assertRecord(record, instanceIndex);
  const instance = record.instances[instanceIndex];
  const position = new THREE.Vector3().fromArray(instance.position);
  const rotation = new THREE.Euler(instance.rotation[0], instance.rotation[1], instance.rotation[2]);
  const quaternion = new THREE.Quaternion().setFromEuler(rotation);
  const scale = new THREE.Vector3().fromArray(instance.scale);
  const matrix = new THREE.Matrix4().compose(position, quaternion, scale);
  record.object.setMatrixAt(instanceIndex, matrix);
  record.object.instanceMatrix.needsUpdate = true;
  return matrix;
}

export function applyUpdatedInstanceSelectionToMesh(THREE, updateResult) {
  if (!updateResult) return null;
  return applyInstanceTransformToMesh(THREE, updateResult.record, updateResult.instanceIndex);
}
