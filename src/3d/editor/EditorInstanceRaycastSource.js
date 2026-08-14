function assertCanvas(canvas) {
  if (!canvas || typeof canvas.getBoundingClientRect !== 'function') throw new TypeError('canvas bounds API is required');
}

function assertRaycaster(raycaster) {
  if (!raycaster || typeof raycaster.setFromCamera !== 'function' || typeof raycaster.intersectObjects !== 'function') {
    throw new TypeError('raycaster setFromCamera/intersectObjects API is required');
  }
}

function assertFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} function is required`);
}

export function createEditorInstanceRaycastSource(options = {}) {
  const canvas = options.canvas;
  const camera = options.camera;
  const raycaster = options.raycaster;
  const getObjects = options.getObjects;
  assertCanvas(canvas);
  if (!camera) throw new TypeError('camera is required');
  assertRaycaster(raycaster);
  assertFunction(getObjects, 'getObjects');

  const pointer = { x: 0, y: 0 };

  function getHits(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return [];
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    const objects = getObjects();
    if (!Array.isArray(objects) || objects.length === 0) return [];
    const candidates = objects.filter((object) => object && object.isInstancedMesh === true);
    if (candidates.length === 0) return [];
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(candidates, false);
    return Array.isArray(hits) ? hits : [];
  }

  function getPointerSnapshot() {
    return Object.freeze({ x: pointer.x, y: pointer.y });
  }

  return Object.freeze({ getHits, getPointerSnapshot });
}
