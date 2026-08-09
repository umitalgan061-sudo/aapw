export const EDITOR_SCENE_SCHEMA_VERSION = 1;

function round(value) {
  return Number(value.toFixed(6));
}

function vector3(vector) {
  return [round(vector.x), round(vector.y), round(vector.z)];
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
    objects: objects.map((object) => ({
      id: object.userData.editorId,
      name: object.name,
      asset: object.userData.editorAssetId,
      transform: {
        position: vector3(object.position),
        rotation: vector3(object.rotation),
        scale: vector3(object.scale)
      }
    })),
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
