function finiteTriplet(value, label, fallback) {
  const source = value === undefined ? fallback : value;
  if (!Array.isArray(source) || source.length !== 3 || source.some((entry) => !Number.isFinite(entry))) {
    throw new TypeError(`${label} must be a finite [x,y,z] triplet`);
  }
  return source.map(Number);
}

function positiveScale(value, fallback) {
  const scale = finiteTriplet(value, 'scale', fallback);
  if (scale.some((entry) => entry <= 0)) throw new RangeError('scale entries must be greater than zero');
  return scale;
}

export function buildInstanceSelectionIndex(groups = []) {
  if (!Array.isArray(groups)) throw new TypeError('groups must be an array');
  const index = new Map();
  for (const record of groups) {
    if (!record || !Array.isArray(record.instances)) continue;
    for (let instanceIndex = 0; instanceIndex < record.instances.length; instanceIndex += 1) {
      const instance = record.instances[instanceIndex];
      const id = instance?.id;
      if (typeof id !== 'string' || id.length === 0) throw new TypeError('instance id must be a non-empty string');
      if (index.has(id)) throw new Error(`Duplicate editor instance id: ${id}`);
      index.set(id, { record, instance, instanceIndex });
    }
  }
  return index;
}

export function readInstanceSelection(groups, instanceId) {
  const match = buildInstanceSelectionIndex(groups).get(instanceId);
  if (!match) return null;
  const { record, instance, instanceIndex } = match;
  return {
    groupId: record.id,
    assetId: record.assetId,
    instanceIndex,
    instanceId: instance.id,
    transform: {
      position: finiteTriplet(instance.position, 'position', [0, 0, 0]),
      rotation: finiteTriplet(instance.rotation, 'rotation', [0, 0, 0]),
      scale: positiveScale(instance.scale, [1, 1, 1])
    }
  };
}

export function updateInstanceSelection(groups, instanceId, patch = {}) {
  const match = buildInstanceSelectionIndex(groups).get(instanceId);
  if (!match) return null;
  const { record, instance, instanceIndex } = match;
  const nextPosition = finiteTriplet(patch.position, 'position', instance.position || [0, 0, 0]);
  const nextRotation = finiteTriplet(patch.rotation, 'rotation', instance.rotation || [0, 0, 0]);
  const nextScale = positiveScale(patch.scale, instance.scale || [1, 1, 1]);

  instance.position = nextPosition;
  instance.rotation = nextRotation;
  instance.scale = nextScale;

  return {
    record,
    instance,
    instanceIndex,
    selection: {
      groupId: record.id,
      assetId: record.assetId,
      instanceIndex,
      instanceId: instance.id,
      transform: {
        position: [...nextPosition],
        rotation: [...nextRotation],
        scale: [...nextScale]
      }
    }
  };
}
