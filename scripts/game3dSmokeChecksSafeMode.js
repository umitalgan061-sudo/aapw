/**
 * game3dSmokeChecksSafeMode.js — committed regression guard for `src/3d/safeMode.js`'s
 * ADR-0106 fix: the two GOVERNANCE.md §8.13 helpers (`updateEntitiesSafely`, `updateSystemSafely`)
 * must never let a *cleanup* call (`entity.dispose()` / `disposeOnError()`) that itself throws
 * escape the helper — that would re-crash the frame loop this module exists to protect, one level
 * further down than the original `update()` throw it was already catching.
 *
 * ADR-0105 shipped both helpers with this gap documented as a known, deliberately-deferred
 * follow-up (fixing it there would have made a behavior-preserving refactor commit quietly
 * behavior-changing). ADR-0106 (run 83) closes it. This check proves the fix against the real
 * served `safeMode.js` module — not a copy — via the same in-page dynamic-`import()` pattern every
 * sibling check module in this project already uses, so a future edit to the real file is what this
 * guards against, not a description of one.
 *
 * Sibling check modules: see `smokeTestGame3D.js`'s own header comment for the full list.
 * Every function here takes `(browser, baseUrl)` and returns `Promise<{name, ok, details}>`.
 * @module scripts/game3dSmokeChecksSafeMode
 */

/** Same convention/value as every sibling check module's own copy of this constant. */
// Run 332 RCA (game3d.js line-cap extraction, ADR-0279): this project's own boot cost has grown
// past this constant's original assumption -- run-326/330/330b/331's procedural creatures, real
// castle models, and villages pushed a real game3d.html boot to ~9-13s (observed via direct
// domcontentloaded-timing instrumentation) in this project's software-WebGL sandboxed CI/dev
// environment, which sat right at or over the old 10s/15s ceiling -- a pre-existing flake
// (already recorded as an "environment quirk" by game3dSmokeChecksScene.js's own run-68 comment)
// that reproduced on unmodified `main` in this run's own RCA, not something the run's actual code
// change caused (confirmed: that change executes strictly after the domcontentloaded event this
// timeout gates on). Run283 later measured a cold shared-runner outlier beyond 30s after the full
// shipped-browser suite had already exercised five smoke phases. 120s is navigation tolerance only;
// it does not relax any safe-mode assertion or in-page gameplay/runtime contract below.
const NAV_TIMEOUT_MS = 120_000;

/**
 * Regression guard for `safeMode.js`'s `updateEntitiesSafely` (DECISIONS.md ADR-0106): a throwing
 * `entity.dispose()` — called from inside the helper's own catch block, cleaning up after an
 * `update()` that already threw — must be caught too, not escape the helper. Also re-confirms the
 * pre-existing, unchanged guarantees from ADR-0104/ADR-0105 (bad entity removed from scene + list,
 * healthy siblings keep updating, healthy path returns the same array reference untouched).
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkSafeModeEntityDisposeThrows(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { updateEntitiesSafely } = await import('/src/3d/safeMode.js');

			const removedFromScene = [];
			const scene = { remove: (obj) => removedFromScene.push(obj) };

			const okEntity = { object3D: { name: 'ok' }, disposed: false, dispose() { this.disposed = true; } };
			const badEntity = {
				object3D: { name: 'bad' },
				disposed: false,
				dispose() {
					this.disposed = true; // still runs its own cleanup body before throwing
					throw new Error('dispose() also throws — must not escape updateEntitiesSafely');
				},
			};

			let threwPastHelper = false;
			let returned;
			try {
				returned = updateEntitiesSafely({
					entities: [okEntity, badEntity],
					scene,
					label: 'TestEntity',
					update: (entity) => {
						if (entity === badEntity) throw new Error('update() throws');
					},
				});
			} catch (error) {
				threwPastHelper = true;
			}

			const disposeThrowContained = !threwPastHelper;
			const badEntityRemovedFromReturnedList = Array.isArray(returned) && returned.length === 1 && returned[0] === okEntity;
			const badEntityRemovedFromScene = removedFromScene.includes(badEntity.object3D);
			const badEntityMarkedDisabled = badEntity.disabledDueToError === true;
			const okEntityUntouched = okEntity.disabled === undefined && !okEntity.disposed;

			// Healthy path (no throw anywhere): must still return the exact same array reference,
			// per ADR-0105's no-allocation-on-a-healthy-frame guarantee — unchanged by this fix.
			const healthyEntities = [{ object3D: { name: 'fine' }, dispose() {} }];
			const healthyReturn = updateEntitiesSafely({
				entities: healthyEntities,
				scene,
				label: 'TestEntity',
				update: () => {},
			});
			const healthyPathSameReference = healthyReturn === healthyEntities;

			return {
				disposeThrowContained, badEntityRemovedFromReturnedList, badEntityRemovedFromScene,
				badEntityMarkedDisabled, okEntityUntouched, healthyPathSameReference,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	const details = ok
		? 'a throwing entity.dispose() called from inside the catch block no longer escapes ' +
			'updateEntitiesSafely; the bad entity is still removed from the scene + returned list and ' +
			'marked disabled, its healthy sibling is untouched, and the no-throw healthy path still ' +
			'returns the same array reference (no allocation)'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'safe-mode dispose()-throws containment, per-entity (src/3d/safeMode.js, ADR-0106)', ok, details };
}

/**
 * Same guarantee as {@link checkSafeModeEntityDisposeThrows}, for `updateSystemSafely`'s singleton
 * shape: a throwing `disposeOnError()` must not escape, and the system must still end up latched
 * disabled regardless of whether its own cleanup succeeded.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkSafeModeSystemDisposeThrows(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { updateSystemSafely } = await import('/src/3d/safeMode.js');

			let disposeOnErrorRan = false;
			let threwPastHelper = false;
			let disabledAfter;
			try {
				disabledAfter = updateSystemSafely({
					disabled: false,
					label: 'TestSystem',
					update: () => { throw new Error('update() throws'); },
					disposeOnError: () => {
						disposeOnErrorRan = true;
						throw new Error('disposeOnError() also throws — must not escape updateSystemSafely');
					},
				});
			} catch (error) {
				threwPastHelper = true;
			}

			const disposeThrowContained = !threwPastHelper;
			const latchedDisabled = disabledAfter === true;

			// Once latched disabled, a further call must stay a no-op (never re-call update/dispose).
			let updateCalledAgain = false;
			const stillDisabled = updateSystemSafely({
				disabled: true,
				label: 'TestSystem',
				update: () => { updateCalledAgain = true; },
			});

			// No-disposeOnError healthy path (e.g. `interaction`, which owns nothing to release) is
			// unaffected: a throw with no disposeOnError still latches disabled without erroring.
			let noDisposeOnErrorThrew = false;
			let noDisposeOnErrorDisabled;
			try {
				noDisposeOnErrorDisabled = updateSystemSafely({
					disabled: false,
					label: 'TestSystemNoCleanup',
					update: () => { throw new Error('update() throws, no disposeOnError provided'); },
				});
			} catch (error) {
				noDisposeOnErrorThrew = true;
			}

			return {
				disposeThrowContained, disposeOnErrorRan, latchedDisabled,
				staysLatchedAndSkipsUpdate: stillDisabled === true && !updateCalledAgain,
				noDisposeOnErrorCaseStillWorks: !noDisposeOnErrorThrew && noDisposeOnErrorDisabled === true,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	const details = ok
		? 'a throwing disposeOnError() no longer escapes updateSystemSafely; the system still ends ' +
			'up latched disabled, stays latched (update() never called again) on a later call, and the ' +
			'no-disposeOnError-provided case (e.g. interaction) is unaffected'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'safe-mode dispose()-throws containment, singleton (src/3d/safeMode.js, ADR-0106)', ok, details };
}

module.exports = { checkSafeModeEntityDisposeThrows, checkSafeModeSystemDisposeThrows };
