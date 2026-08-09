/**
 * Run200 developer-only scene manager proxy.
 *
 * The import map in game3d-canonical-dev.html redirects only game3d.js's exact
 * ./src/3d/sceneManager.js URL here. This proxy then imports the unchanged real
 * sceneManager.js through a query-qualified URL so the import-map redirect does
 * not recurse, and captures the returned state for the opt-in canonical startup
 * harness. The default game3d.html import graph never references this file.
 */
import {
	createScene as createRealScene,
	isCoarsePointerDevice,
} from '../src/3d/sceneManager.js?run200-original=1';

export { isCoarsePointerDevice };

export function createScene(canvas) {
	const state = createRealScene(canvas);
	window.__WESTEROS_RUN200_RUNTIME_STATE__ = state;
	return state;
}
