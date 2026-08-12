export const EDITOR_SCENE_SCHEMA_VERSION = 1;

const TERRAIN_ASSET_IDS = new Set(['editor-land-cell', 'editor-water-cell']);
const HTERRAIN_SURFACES = new Set(['auto', 'grass', 'earth', 'rock', 'snow']);

function round(value) {
  return Number(value.toFixed(6));
}

function vector3(vector) {
  return [round(vector.x), round(vector.y), round(vector.z)];
}

function serializeTerrainAuthoring(object) {
  if (!TERRAIN_ASSET_IDS.has(object.userData?.editorAssetId)) return undefined;
  const surface = String(object.userData?.editorHTerrainSurface || 'auto');
  const elevation = Number(object.userData?.editorTerrainElevationMeters);
  return {
    hterrainSurface: HTERRAIN_SURFACES.has(surface) ? surface : 'auto',
    ...(Number.isFinite(elevation) ? { elevationMeters: round(elevation) } : {})
  };
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
      },
      terrain: serializeTerrainAuthoring(object)
    })),
    instanceGroups
  };
}

export function validateEditorScene(data) {
  if (!data || typeof data !== 'object') throw new Error('Scene JSON bir obje olmalı.');
  if (data.schemaVersion !== EDITOR_SCENE_SCHEMA_VERSION) throw new Error(`Desteklenmeyen scene schemaVersion: ${data.schemaVersion}`);
  if (!Array.isArray(data.objects)) throw new Error('Scene JSON objects dizisi içermeli.');
  if (!Array.isArray(data.instanceGroups)) throw new Error('Scene JSON instanceGroups dizisi içermeli.');
  for (const record of data.objects) {
    if (record?.terrain == null) continue;
    if (typeof record.terrain !== 'object' || Array.isArray(record.terrain)) throw new Error('Scene terrain metadata obje olmalı.');
    const surface = String(record.terrain.hterrainSurface || 'auto');
    if (!HTERRAIN_SURFACES.has(surface)) throw new Error(`Desteklenmeyen HTerrain surface: ${surface}`);
    if (record.terrain.elevationMeters != null && !Number.isFinite(Number(record.terrain.elevationMeters))) {
      throw new Error('HTerrain elevationMeters sayısal olmalı.');
    }
  }
  return data;
}
