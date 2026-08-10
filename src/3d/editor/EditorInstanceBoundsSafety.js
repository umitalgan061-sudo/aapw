function assertRecord(record) {
  if (!record?.object) throw new TypeError('record.object is required');
  if (typeof record.object.computeBoundingSphere !== 'function') {
    throw new TypeError('record.object.computeBoundingSphere is required');
  }
}

export function refreshEditorInstanceMeshBounds(record) {
  assertRecord(record);
  const object = record.object;
  object.computeBoundingSphere();
  if (object.boundingBox !== null && typeof object.computeBoundingBox === 'function') {
    object.computeBoundingBox();
  }
  return object;
}

export function applyBoundsSafeInstanceRender(THREE, updateResult, applyRender) {
  if (typeof applyRender !== 'function') throw new TypeError('applyRender operation is required');
  if (!updateResult?.record) throw new TypeError('updateResult.record is required');
  const result = applyRender(THREE, updateResult);
  refreshEditorInstanceMeshBounds(updateResult.record);
  return result;
}
