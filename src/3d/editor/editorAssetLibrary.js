export const EDITOR_ASSETS = Object.freeze([
  Object.freeze({ id: 'marker-castle', name: 'Kale İşaretçisi', category: 'Mimari', format: 'primitive', primitive: 'castle', instancing: true }),
  Object.freeze({ id: 'marker-tree', name: 'Ağaç İşaretçisi', category: 'Doğa', format: 'primitive', primitive: 'tree', instancing: true }),
  Object.freeze({ id: 'marker-soldier', name: 'Asker İşaretçisi', category: 'Asker', format: 'primitive', primitive: 'soldier', instancing: true }),
  Object.freeze({ id: 'peasant-girl', name: 'Peasant Girl', category: 'NPC', format: 'fbx', src: 'assets/models/characters/peasant_girl.fbx', instancing: false }),
  Object.freeze({ id: 'paladin', name: 'Paladin', category: 'Asker', format: 'fbx', src: 'assets/models/characters/paladin_j_nordstrom.fbx', instancing: false }),
  Object.freeze({ id: 'wolf', name: 'Kurt', category: 'Canlı', format: 'glb', src: 'assets/models/animals/wolf/Wolf-Blender-2.82a.glb', instancing: false }),
  Object.freeze({ id: 'black-dragon', name: 'Siyah Ejderha', category: 'Canlı', format: 'fbx', src: 'assets/models/creatures/dragon/Dragon_Baked_Actions_fbx_7.4_binary.fbx', resourcePath: 'assets/models/creatures/dragon/textures/', instancing: false })
]);

export function findEditorAsset(assetId) {
  return EDITOR_ASSETS.find((asset) => asset.id === assetId) || null;
}
