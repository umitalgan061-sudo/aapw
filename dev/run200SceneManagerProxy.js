/**
 * Run200 developer-only scene manager proxy.
 *
 * The import map in game3d-canonical-dev.html redirects the normalized
 * ./src/3d/sceneManager.js URL here for the developer page's whole module graph.
 * This proxy therefore preserves the complete public export contract used by
 * game3d.js and gameLoopHelpers.js, while wrapping only createScene() to capture
 * the returned state. It imports the unchanged real module through a
 * query-qualified URL so the import-map redirect does not recurse. The default
 * game3d.html import graph never references this file.
 */
import {
	createScene as createRealScene,
	isCoarsePointerDevice,
	worldToChunkCoord,
} from '../src/3d/sceneManager.js?run200-original=1';

export { isCoarsePointerDevice, worldToChunkCoord };

export function createScene(canvas) {
	const state = createRealScene(canvas);
	window.__WESTEROS_RUN200_RUNTIME_STATE__ = state;
	return state;
}
