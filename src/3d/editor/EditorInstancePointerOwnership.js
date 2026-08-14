function assertFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} function is required`);
}

export function createEditorInstancePointerOwnership(options = {}) {
  const getHits = options.getHits;
  const isActive = options.isActive || (() => false);
  assertFunction(getHits, 'getHits');
  assertFunction(isActive, 'isActive');

  function ownsPointer(event) {
    if (!event || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (isActive()) return true;
    const hits = getHits(event);
    return Array.isArray(hits) && hits.length > 0;
  }

  return Object.freeze({ ownsPointer });
}
