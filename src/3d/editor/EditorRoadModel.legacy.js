const DEFAULT_EDITOR_ROAD_WIDTH_METERS = 8;
const EDITOR_ROAD_VERTICAL_OFFSET_METERS = 0.4;

function finitePoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
    throw new Error('Editor road point must contain finite x/y/z coordinates.');
  }
  return Object.freeze({ x: point.x, y: point.y, z: point.z });
}

function normalizedWidth(widthMeters) {
  const value = Number(widthMeters);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Editor road width must be a positive finite number.');
  return value;
}

export function createEditorRoadRecord({ id, name = 'Yol', widthMeters = DEFAULT_EDITOR_ROAD_WIDTH_METERS, points = [] }) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('Editor road id is required.');
  return Object.freeze({
    id: id.trim(),
    name: typeof name === 'string' && name.trim() ? name.trim() : 'Yol',
    widthMeters: normalizedWidth(widthMeters),
    points: Object.freeze(points.map(finitePoint))
  });
}

export function appendEditorRoadPoint(record, point) {
  return createEditorRoadRecord({
    id: record.id,
    name: record.name,
    widthMeters: record.widthMeters,
    points: [...record.points, finitePoint(point)]
  });
}

export function removeLastEditorRoadPoint(record) {
  if (!record.points.length) return record;
  return createEditorRoadRecord({
    id: record.id,
    name: record.name,
    widthMeters: record.widthMeters,
    points: record.points.slice(0, -1)
  });
}

export function isRenderableEditorRoad(record) {
  return Boolean(record && Array.isArray(record.points) && record.points.length >= 2);
}

export function buildEditorRoadRibbonBuffers(record) {
  if (!isRenderableEditorRoad(record)) return Object.freeze({ positions: Object.freeze([]), indices: Object.freeze([]) });
  const positions = [];
  const indices = [];
  const halfWidth = record.widthMeters / 2;

  for (let i = 0; i < record.points.length; i += 1) {
    const point = record.points[i];
    const prev = record.points[Math.max(0, i - 1)];
    const next = record.points[Math.min(record.points.length - 1, i + 1)];
    const tangentX = next.x - prev.x;
    const tangentZ = next.z - prev.z;
    const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
    const perpX = -tangentZ / tangentLength;
    const perpZ = tangentX / tangentLength;

    positions.push(
      point.x + perpX * halfWidth, point.y + EDITOR_ROAD_VERTICAL_OFFSET_METERS, point.z + perpZ * halfWidth,
      point.x - perpX * halfWidth, point.y + EDITOR_ROAD_VERTICAL_OFFSET_METERS, point.z - perpZ * halfWidth
    );

    if (i > 0) {
      const leftIndex = i * 2;
      const rightIndex = leftIndex + 1;
      const prevLeft = leftIndex - 2;
      const prevRight = rightIndex - 2;
      indices.push(prevLeft, prevRight, leftIndex, prevRight, rightIndex, leftIndex);
    }
  }

  return Object.freeze({ positions: Object.freeze(positions), indices: Object.freeze(indices) });
}

export function serializeEditorRoad(record) {
  return {
    id: record.id,
    name: record.name,
    widthMeters: record.widthMeters,
    points: record.points.map((point) => [point.x, point.y, point.z])
  };
}

export function validateSerializedEditorRoad(value) {
  if (!value || typeof value !== 'object') throw new Error('Serialized editor road must be an object.');
  if (!Array.isArray(value.points)) throw new Error('Serialized editor road points must be an array.');
  return createEditorRoadRecord({
    id: value.id,
    name: value.name,
    widthMeters: value.widthMeters,
    points: value.points.map((point) => {
      if (!Array.isArray(point) || point.length !== 3) throw new Error('Serialized editor road point must be [x,y,z].');
      return { x: Number(point[0]), y: Number(point[1]), z: Number(point[2]) };
    })
  });
}

export const EDITOR_ROAD_POLICY = Object.freeze({
  defaultWidthMeters: DEFAULT_EDITOR_ROAD_WIDTH_METERS,
  verticalOffsetMeters: EDITOR_ROAD_VERTICAL_OFFSET_METERS
});
