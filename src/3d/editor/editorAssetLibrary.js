export const EDITOR_ASSETS = Object.freeze([
  Object.freeze({ id: 'marker-castle', name: 'Kale İşaretçisi', category: 'Mimari', format: 'primitive', primitive: 'castle', instancing: true }),
  Object.freeze({ id: 'marker-tree', name: 'Ağaç İşaretçisi', category: 'Doğa', format: 'primitive', primitive: 'tree', instancing: true }),
  Object.freeze({ id: 'marker-soldier', name: 'Asker İşaretçisi', category: 'Asker', format: 'primitive', primitive: 'soldier', instancing: true }),
  Object.freeze({ id: 'peasant-girl', name: 'Peasant Girl', category: 'NPC', format: 'fbx', src: 'assets/models/characters/peasant_girl.fbx', instancing: false }),
  Object.freeze({ id: 'paladin', name: 'Paladin', category: 'Asker', format: 'fbx', src: 'assets/models/characters/paladin_j_nordstrom.fbx', instancing: false }),
  Object.freeze({ id: 'wolf', name: 'Kurt', category: 'Canlı', format: 'glb', src: 'assets/models/animals/wolf/Wolf-Blender-2.82a.glb', instancing: false }),
  Object.freeze({ id: 'castle_icebound_citadel_decimated', name: 'Buz Hisarı', category: 'Bina', format: 'glb', src: 'assets/models/settlements/castles/icebound_citadel_decimated.glb', instancing: false, targetMaxDimension: 46 }),
  Object.freeze({ id: 'castle_walled_city_fortress_decimated', name: 'Surlu Şehir Kalesi', category: 'Bina', format: 'glb', src: 'assets/models/settlements/castles/walled_city_fortress_decimated.glb', instancing: false, targetMaxDimension: 46 }),
  Object.freeze({ id: 'castle_fortress_of_the_crown_decimated', name: 'Taç Kalesi', category: 'Bina', format: 'glb', src: 'assets/models/settlements/castles/fortress_of_the_crown_decimated.glb', instancing: false, targetMaxDimension: 46 }),
  Object.freeze({ id: 'castle_castle_on_a_rock_decimated', name: 'Kayalık Kale', category: 'Bina', format: 'glb', src: 'assets/models/settlements/castles/castle_on_a_rock_decimated.glb', instancing: false, targetMaxDimension: 46 }),
  Object.freeze({ id: 'castle_emerald_citadel_decimated', name: 'Zümrüt Hisarı', category: 'Bina', format: 'glb', src: 'assets/models/settlements/castles/emerald_citadel_decimated.glb', instancing: false, targetMaxDimension: 46 }),
  Object.freeze({ id: 'castle_greystone_castle_decimated', name: 'Boztaş Kalesi', category: 'Bina', format: 'glb', src: 'assets/models/settlements/castles/greystone_castle_decimated.glb', instancing: false, targetMaxDimension: 46 }),
  Object.freeze({ id: 'castle_brickstone_citadel_decimated', name: 'Tuğlataş Hisarı', category: 'Bina', format: 'glb', src: 'assets/models/settlements/castles/brickstone_citadel_decimated.glb', instancing: false, targetMaxDimension: 46 }),
  Object.freeze({ id: 'castle_reference_gatehouse_decimated', name: 'Köprülü Geçit Kalesi', category: 'Bina', format: 'glb', src: 'assets/models/settlements/castles/gatehouse_reference_decimated.glb', instancing: false, targetMaxDimension: 46 }),
  Object.freeze({ id: 'editor-land-cell', name: 'Kara Hücresi', category: 'Arazi', format: 'primitive', primitive: 'land-cell', instancing: false }),
  Object.freeze({ id: 'editor-water-cell', name: 'Deniz Hücresi', category: 'Arazi', format: 'primitive', primitive: 'water-cell', instancing: false }),
  Object.freeze({ id: 'editor-road-segment', name: 'Ana Yol Segmenti', category: 'Yol', format: 'primitive', primitive: 'road-segment', instancing: false }),
  Object.freeze({ id: 'black-dragon', name: 'Siyah Ejderha', category: 'Canlı', format: 'fbx', src: 'assets/models/creatures/dragon/Dragon_Baked_Actions_fbx_7.4_binary.fbx', resourcePath: 'assets/models/creatures/dragon/textures/', instancing: false })
]);

export function findEditorAsset(assetId) {
  return EDITOR_ASSETS.find((asset) => asset.id === assetId) || null;
}
