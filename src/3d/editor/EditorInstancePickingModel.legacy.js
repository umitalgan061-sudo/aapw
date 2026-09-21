function findGroupForObject(groups, object) {
  if (!Array.isArray(groups)) throw new TypeError('groups must be an array');
  return groups.find((record) => record?.object === object) || null;
}

export function resolveEditorInstancePick(groups, hit) {
  if (!hit || !Number.isInteger(hit.instanceId) || hit.instanceId < 0) return null;
  const record = findGroupForObject(groups, hit.object);
  if (!record || !Array.isArray(record.instances) || hit.instanceId >= record.instances.length) return null;
  const instance = record.instances[hit.instanceId];
  if (!instance || typeof instance.id !== 'string' || instance.id.length === 0) return null;
  return {
    groupId: record.id,
    assetId: record.assetId,
    instanceIndex: hit.instanceId,
    instanceId: instance.id,
    record,
    instance
  };
}

export function resolveNearestEditorInstancePick(groups, hits) {
  if (!Array.isArray(hits)) throw new TypeError('hits must be an array');
  for (const hit of hits) {
    const selection = resolveEditorInstancePick(groups, hit);
    if (selection) return selection;
  }
  return null;
}
