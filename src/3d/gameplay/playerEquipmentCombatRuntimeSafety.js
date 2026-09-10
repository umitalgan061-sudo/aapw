export function createPlayerEquipmentCombatRuntimeSafety({ runtime } = {}) {
  if (!runtime || typeof runtime.read !== 'function') throw new TypeError('runtime.read required');
  let disposed = false;
  const errors = [];
  const call = (fallback, operation, fn) => {
    if (disposed) return fallback;
    try { return fn(); } catch (error) {
      errors.push({ operation, message: String(error?.message || error).slice(0, 240) });
      return fallback;
    }
  };
  return Object.freeze({
    update: (delta, timestamp) => call(runtime.read(), 'update', () => runtime.update?.(delta, timestamp) ?? runtime.read()),
    refreshEquipment: (timestamp) => call(runtime.read(), 'refreshEquipment', () => runtime.refreshEquipment?.(timestamp) ?? runtime.read()),
    read: () => call(Object.freeze({ version: 1, phase: 'idle', safety: 'fallback' }), 'read', () => runtime.read()),
    readHistory: () => call(Object.freeze([]), 'readHistory', () => runtime.readHistory?.() ?? []),
    materialAudit: () => call(Object.freeze({ status: 'unavailable' }), 'materialAudit', () => runtime.materialAudit?.() ?? { status: 'unavailable' }),
    diagnostics: () => Object.freeze({ disposed, errors: [...errors] }),
    dispose: () => { if (!disposed) { disposed = true; runtime.dispose?.(); } },
  });
}
