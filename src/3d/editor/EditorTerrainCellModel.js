const DEFAULT_TERRAIN_CELL_SIZE_METERS = 10;
const LAND_SURFACE_OFFSET_METERS = 0.02;
const WATER_SURFACE_OFFSET_METERS = 0.08;

function normalizedCellSize(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('Terrain cell size must be a positive finite number.');
  return numeric;
}

export function snapEditorTerrainCell(point, cellSizeMeters = DEFAULT_TERRAIN_CELL_SIZE_METERS) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
    throw new Error('Terrain paint point must contain finite x/y/z coordinates.');
  }
  const size = normalizedCellSize(cellSizeMeters);
  return Object.freeze({
    x: Math.round(point.x / size) * size,
    y: point.y,
    z: Math.round(point.z / size) * size,
    size
  });
}

export function editorTerrainCellKey(kind, cell) {
  if (kind !== 'land' && kind !== 'water') throw new Error('Terrain cell kind must be land or water.');
  return `${kind}:${cell.x}:${cell.z}:${cell.size}`;
}

export const EDITOR_TERRAIN_CELL_POLICY = Object.freeze({
  defaultCellSizeMeters: DEFAULT_TERRAIN_CELL_SIZE_METERS,
  landSurfaceOffsetMeters: LAND_SURFACE_OFFSET_METERS,
  waterSurfaceOffsetMeters: WATER_SURFACE_OFFSET_METERS
});
