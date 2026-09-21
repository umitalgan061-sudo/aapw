const PATCH_KIND_BY_ASSET = Object.freeze({
  'editor-road-segment': 'roads',
  'editor-land-cell': 'landCells',
  'editor-water-cell': 'waterCells'
});

const PATCH_COLLECTIONS = Object.freeze(['buildings', 'roads', 'landCells', 'waterCells', 'objects']);

function finiteTriplet(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => !Number.isFinite(Number(entry)))) {
    throw new Error(`${label} must be a finite [x,y,z] triplet.`);
  }
  return Object.freeze(value.map(Number));
}

function compileObject(record) {
  if (!record || typeof record !== 'object') throw new Error('Editor scene object record must be an object.');
  if (typeof record.id !== 'string' || !record.id.trim()) throw new Error('Editor scene object id is required.');
  if (typeof record.asset !== 'string' || !record.asset.trim()) throw new Error(`Editor scene object ${record.id} asset is required.`);
  if (!record.transform || typeof record.transform !== 'object') throw new Error(`Editor scene object ${record.id} transform is required.`);
  return Object.freeze({
    id: record.id,
    name: typeof record.name === 'string' ? record.name : record.id,
    asset: record.asset,
    position: finiteTriplet(record.transform.position, `${record.id}.position`),
    rotation: finiteTriplet(record.transform.rotation, `${record.id}.rotation`),
    scale: finiteTriplet(record.transform.scale, `${record.id}.scale`)
  });
}

function collectionForAsset(assetId) {
  if (assetId.startsWith('castle_')) return 'buildings';
  return PATCH_KIND_BY_ASSET[assetId] || 'objects';
}

export function compileEditorWorldPatch(sceneData) {
  if (!sceneData || typeof sceneData !== 'object') throw new Error('Editor scene data must be an object.');
  if (sceneData.schemaVersion !== 1) throw new Error(`Unsupported editor scene schemaVersion: ${sceneData.schemaVersion}`);
  if (!Array.isArray(sceneData.objects)) throw new Error('Editor scene objects must be an array.');
  if (!Array.isArray(sceneData.instanceGroups)) throw new Error('Editor scene instanceGroups must be an array.');

  const ids = new Set();
  const buckets = Object.fromEntries(PATCH_COLLECTIONS.map((name) => [name, []]));
  const sorted = [...sceneData.objects].sort((left, right) => String(left?.id || '').localeCompare(String(right?.id || ''), 'en'));
  for (const record of sorted) {
    const compiled = compileObject(record);
    if (ids.has(compiled.id)) throw new Error(`Duplicate editor object id: ${compiled.id}`);
    ids.add(compiled.id);
    buckets[collectionForAsset(compiled.asset)].push(compiled);
  }

  const instanceGroups = Object.freeze(sceneData.instanceGroups.map((group) => Object.freeze(structuredClone(group))));
  return Object.freeze({
    patchVersion: 1,
    sourceSchemaVersion: sceneData.schemaVersion,
    coordinateSystem: sceneData.world?.coordinateSystem || 'threejs-y-up',
    units: sceneData.world?.units || 'meters',
    buildings: Object.freeze(buckets.buildings),
    roads: Object.freeze(buckets.roads),
    landCells: Object.freeze(buckets.landCells),
    waterCells: Object.freeze(buckets.waterCells),
    objects: Object.freeze(buckets.objects),
    instanceGroups
  });
}

export function editorWorldPatchStats(patch) {
  if (!patch || typeof patch !== 'object') throw new Error('Editor world patch is required.');
  return Object.freeze({
    buildings: patch.buildings?.length || 0,
    roads: patch.roads?.length || 0,
    landCells: patch.landCells?.length || 0,
    waterCells: patch.waterCells?.length || 0,
    objects: patch.objects?.length || 0,
    instanceGroups: patch.instanceGroups?.length || 0
  });
}

export const EDITOR_WORLD_PATCH_POLICY = Object.freeze({
  patchVersion: 1,
  sourceSchemaVersion: 1,
  collections: PATCH_COLLECTIONS
});
