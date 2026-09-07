/**
 * Runtime adapter for the existing game loop. It owns only lifecycle wiring for the
 * bounded living-world scheduler; entity behavior and ownership remain in their callers.
 * @module gameplay/livingWorldRuntimeAdapter
 */
import { createLivingWorldRuntimeSlice } from './livingWorldRuntimeSlice.js';

export function attachLivingWorldRuntime({ state = {}, playerPositionProvider } = {}) {
  const slice = createLivingWorldRuntimeSlice({ state, playerPositionProvider });
  state.livingWorldRuntimeSlice = slice;
  return slice;
}

export function tickLivingWorldRuntime(state, delta, playerPosition) {
  return state?.livingWorldRuntimeSlice?.tick(delta, playerPosition) ?? Object.freeze({ disposed: true });
}

export function disposeLivingWorldRuntime(state) {
  state?.livingWorldRuntimeSlice?.dispose?.();
  if (state) delete state.livingWorldRuntimeSlice;
}
