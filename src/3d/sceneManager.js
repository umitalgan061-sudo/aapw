/* TypeScript ownership compatibility boundary. */
import * as __typed from './sceneManager.ts';
import { applyPhotorealismSceneTuning } from './world/photorealismSceneTuning.ts';
export * from './sceneManager.ts';

export function createScene(canvas) {
  const state = __typed.createScene(canvas);
  const tuning = applyPhotorealismSceneTuning(state.scene);
  state.photorealismSceneTuning = tuning;
  console.info(
    `[sceneManager] Photorealism backdrop guard: #${tuning.backgroundHex.toString(16).padStart(6, '0')}, ` +
      `luminance=${tuning.backgroundLuminance.toFixed(3)}, ` +
      `fogFallback=${tuning.fogFallbackApplied}.`,
  );
  return state;
}
