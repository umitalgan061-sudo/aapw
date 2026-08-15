export const EDITOR_SCENE_SCHEMA_VERSION = 1;

function round(value) {
  return Number(value.toFixed(6));
}

function vector3(vector) {
  return [round(vector.x), round(vector.y), round(vector.z)];
}

function tuple3(values) {
  if (!Array.isArray(values) || values.length !== 3) return null;
  const tuple = values.map(Number);
  if (tuple.some((value) => !Number.isFinite(value))) return null;
  return tuple.map(round);
}

function serializeFbxPackOverrides(object) {
  const source = object?.userData?.editorFbxPackOverrides;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const records = Object.keys(source).sort().map((path) => {
    const record = source[path];
    const position = tuple3(record?.transform?.position);
    const rotation = tuple3(record?.transform?.rotation);
    const scale = tuple3(record?.transform?.scale);
    if (!path || !position || !rotation || !scale) return null;
    return {
      path,
      name: String(record?.name || ''),
      transform: { position, rotation, scale }
    };
  }).filter(Boolean);
  return records.length ? records : null;
}

function serializeObject(object) {
  const record = {
    id: object.userData.editorId,
    name: object.name,
    asset: object.userData.editorAssetId,
    transform: {
      position: vector3(object.position),
      rotation: vector3(object.rotation),
      scale: vector3(object.scale)
    }
  };
  const fbxPacks = serializeFbxPackOverrides(object);
  if (fbxPacks) record.fbxPacks = fbxPacks;
  return record;
}

export function serializeEditorScene(objects, instanceGroups, editorState) {
  return {
    schemaVersion: EDITOR_SCENE_SCHEMA_VERSION,
    world: { name: 'Westeros', coordinateSystem: 'threejs-y-up', units: 'meters' },
    editor: {
      gridVisible: Boolean(editorState.gridVisible),
      snapEnabled: Boolean(editorState.snapEnabled),
      snapSize: Number(editorState.snapSize)
    },
    objects: objects.map(serializeObject),
    instanceGroups
  };
}

export function validateEditorScene(data) {
  if (!data || typeof data !== 'object') throw new Error('Scene JSON bir obje olmalı.');
  if (data.schemaVersion !== EDITOR_SCENE_SCHEMA_VERSION) throw new Error(`Desteklenmeyen scene schemaVersion: ${data.schemaVersion}`);
  if (!Array.isArray(data.objects)) throw new Error('Scene JSON objects dizisi içermeli.');
  if (!Array.isArray(data.instanceGroups)) throw new Error('Scene JSON instanceGroups dizisi içermeli.');
  return data;
}
