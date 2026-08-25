/**
 * Focused shipped-browser checks for the F4 free camera and F2 profiling panel.
 *
 * World-event/toast and day/night acceptance moved to `game3dSmokeChecksWorldEvents.js` when the
 * runtime adopted bounded resume-frame simulation. Keeping the old world-event checks exported
 * here would create two owners for the same acceptance surface and, more importantly, leaves the
 * smoke registry believing those stale `update(1000)` checks must still be invoked. This module
 * therefore owns debug tools only; `smokeTestGame3D.js` owns the combined registry.
 * @module scripts/game3dSmokeChecksDebugTools
 */

const NAV_TIMEOUT_MS = 30_000;

/** Proves the real F4 free-fly controller activates, copies pose, moves, and deactivates. */
async function checkFreeCamera(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		await page.setViewportSize({ width: 390, height: 844 });
		result = await page.evaluate(async () => {
			const { createFreeCameraController } = await import('/src/3d/debug/freeCamera.js');
			const THREE = await import('/src/3d/vendor/three/three.module.js');
			const sourceCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
			sourceCamera.position.set(10, 20, 30);
			sourceCamera.lookAt(0, 20, 0);
			const domElement = document.createElement('canvas');
			const controller = createFreeCameraController({ sourceCamera, domElement });

			const inactiveInitially = controller.active === false;
			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
			controller.update(1);
			const staysPutWhileInactive = controller.camera.position.length() === 0;

			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' }));
			const activatedOnF4 = controller.active === true;
			const poseCopiedOnActivate = controller.camera.position.distanceTo(sourceCamera.position) < 1e-6
				&& controller.camera.quaternion.angleTo(sourceCamera.quaternion) < 1e-6;

			const positionBeforeMove = controller.camera.position.clone();
			controller.update(0.5);
			const movedForward = controller.camera.position.distanceTo(positionBeforeMove) > 0;

			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' }));
			const deactivatedOnSecondF4 = controller.active === false;
			window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
			controller.dispose();

			return {
				inactiveInitially, staysPutWhileInactive, activatedOnF4, poseCopiedOnActivate,
				movedForward, deactivatedOnSecondF4,
			};
		});
	} catch (error) {
		result = { error: String(error) };
	}
	await page.close();
	const ok = result && Object.values(result).every((value) => value === true);
	const details = ok
		? 'inactive by default, no-ops while inactive, F4 activates (copies source pose)/deactivates, WASD moves it once active'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'F4 debug free-fly camera (debug/freeCamera.js, ADR-0049)', ok, details };
}

/** Proves the real F2 panel lifecycle, budgets, throttling, and storage telemetry. */
async function checkPerfPanel(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createPerfPanel } = await import('/src/3d/debug/perfPanel.js');
			const fakeRenderer = { info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } } };
			const panel = createPerfPanel({ renderer: fakeRenderer, isMobileClass: false });
			const el = document.querySelector('.g3d-perf-panel');

			const inactiveInitially = panel.active === false;
			const hiddenInitially = el.hidden === true;
			fakeRenderer.info.render.calls = 999;
			panel.update(1);
			const noWriteWhileInactive = el.textContent === '';

			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F2' }));
			const activatedOnF2 = panel.active === true;
			const domVisibleOnActivate = el.hidden === false;

			fakeRenderer.info.render.calls = 100;
			fakeRenderer.info.render.triangles = 200000;
			fakeRenderer.info.memory.geometries = 5;
			fakeRenderer.info.memory.textures = 3;
			panel.update(0.1);
			const throttledNoWriteBelowInterval = el.textContent === '';
			panel.update(0.2);
			const text1 = el.textContent;
			const writesAfterThrottleInterval = text1.includes('Draw calls: 100 / 2500 (Desktop)')
				&& text1.includes('Triangles: 200,000 / 5,000,000 (Desktop)')
				&& text1.includes('Geometries: 5') && text1.includes('Textures: 3');
			const storageShowsMeasuringBeforeResolve = text1.includes('Storage: measuring…');

			fakeRenderer.info.render.calls = 3000;
			panel.update(0.3);
			const overBudgetFlagged = el.textContent.includes('/ 2500 (Desktop) !');

			await new Promise((resolve) => setTimeout(resolve, 150));
			panel.update(0.3);
			const text2 = el.textContent;
			const storageResolvedWithRealNumbers = /Storage: \d+\.\d \/ \d+ MB \(\d+%\)( !)?$/.test(text2);

			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F2' }));
			const deactivatedOnSecondF2 = panel.active === false;
			const hiddenAfterSecondF2 = el.hidden === true;
			panel.dispose();
			const disposedRemovesDom = document.querySelector('.g3d-perf-panel') === null;

			const fakeMobileRenderer = { info: { render: { calls: 620, triangles: 0 }, memory: { geometries: 0, textures: 0 } } };
			const mobilePanel = createPerfPanel({ renderer: fakeMobileRenderer, isMobileClass: true });
			const mobileEl = document.querySelector('.g3d-perf-panel');
			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F2' }));
			mobilePanel.update(0.3);
			const mobileBudgetUsed = mobileEl.textContent.includes('/ 500 (Mobile) !');
			mobilePanel.dispose();

			const originalStorage = navigator.storage;
			Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
			const noStoragePanel = createPerfPanel({ renderer: fakeRenderer, isMobileClass: false });
			const noStorageEl = document.querySelector('.g3d-perf-panel');
			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F2' }));
			noStoragePanel.update(0.3);
			const unsupportedFallbackShown = noStorageEl.textContent.includes('Storage: unsupported (no navigator.storage.estimate)');
			noStoragePanel.dispose();
			Object.defineProperty(navigator, 'storage', { value: originalStorage, configurable: true });

			return {
				inactiveInitially, hiddenInitially, noWriteWhileInactive, activatedOnF2, domVisibleOnActivate,
				throttledNoWriteBelowInterval, writesAfterThrottleInterval, overBudgetFlagged,
				storageShowsMeasuringBeforeResolve, storageResolvedWithRealNumbers, unsupportedFallbackShown,
				deactivatedOnSecondF2, hiddenAfterSecondF2, disposedRemovesDom, mobileBudgetUsed,
			};
		});
	} catch (error) {
		result = { error: String(error) };
	}
	await page.close();
	const ok = result && Object.values(result).every((value) => value === true);
	const details = ok
		? 'inactive by default, no-ops while inactive, F2 activates/deactivates, refresh-throttled writes, over-budget flag, dispose removes DOM, isMobileClass swaps in the mobile budget, storage-quota line measures-then-resolves with real numbers, unsupported fallback shown when navigator.storage is stubbed away'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'F2 debug/profiling panel (debug/perfPanel.js, ADR-0053/ADR-0084)', ok, details };
}

module.exports = {
	checkFreeCamera,
	checkPerfPanel,
};
