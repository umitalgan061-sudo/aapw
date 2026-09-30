/**
 * F2 debug/profiling panel: a real-time `renderer.info`-based readout of draw calls, triangles,
 * and resident geometry/texture object counts, checked against this project's own desktop/mobile
 * perf budgets (see this file's `DESKTOP_BUDGET`/`MOBILE_BUDGET`). Built to answer a real gap
 * `3D_GAME_PROGRESS.md`'s World Coverage entry has flagged twice (ADR-0047, ADR-0049): every prior
 * attempt to grow `CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS` had to reason from *estimated*
 * triangle counts (`chunkManager`'s own per-chunk math) because nothing in this repo could report
 * the real, GPU-side draw-call/triangle cost of a frame. This panel is that instrumentation — see
 * DECISIONS.md ADR-0053.
 *
 * Self-contained, same conventions `debug/freeCamera.js` (F4) already established: owns its own F2
 * keydown listener, its own DOM element, a no-op `update()` while inactive, and a `dispose()` that
 * removes everything it added. Never touches `WORLD_DEFAULTS`/`PLAYER_CONFIG`'s real gameplay-perf
 * constants — this only *reads* `renderer.info`, it never changes what gets rendered.
 *
 * Run 66 (DECISIONS.md ADR-0084) adds a fourth line: offline PWA storage-quota monitoring
 * (`navigator.storage.estimate()`), closing the "izlenmesi" half of GOVERNANCE.md §15's "PWA Cache
 * Versiyonlama" rule — run 65 (ADR-0083) already closed the cache-*completeness* half. Refreshed on
 * its own, much coarser timer than the render stats (disk usage doesn't change frame-to-frame),
 * feature-detected (older/unsupported browsers just show "unsupported" instead of throwing), and
 * flagged the same way the draw-call/triangle budgets already are once usage crosses
 * `STORAGE_WARN_FRACTION` of the reported quota.
 * @module debug/perfPanel
 */

/** This project's own perf budgets (see `3D_GAME_PROGRESS.md`'s "KOD KALİTESİ" section) — kept
 * local to this debug-only tool rather than in `config.js` (already at the 600-line cap), matching
 * `freeCamera.js`'s own precedent for tool-specific constants. */
const DESKTOP_BUDGET = Object.freeze({ label: 'Desktop', maxDrawCalls: 2500, maxTriangles: 5_000_000 });
const MOBILE_BUDGET = Object.freeze({ label: 'Mobile', maxDrawCalls: 500, maxTriangles: 500_000 });

/** Real DOM writes are throttled to this interval — the underlying `renderer.info` counters are
 * still read fresh every `update()` call, but repainting a legible number every single frame would
 * be needless layout/paint churn for a value a human only glances at occasionally. */
const REFRESH_INTERVAL_SECONDS = 0.25;

/** How often the async `navigator.storage.estimate()` call is re-issued — far coarser than
 * `REFRESH_INTERVAL_SECONDS` above: disk usage only moves when a new asset gets cached (once per
 * session, typically), so polling it every 0.25s would be pure overhead for a number that almost
 * never changes between reads. */
const STORAGE_REFRESH_INTERVAL_SECONDS = 5;

/** Flag the storage line (same trailing `" !"` convention `drawCallsFlag`/`trianglesFlag` below
 * use) once usage crosses this fraction of the reported quota. 0.8, not 1.0: by the time usage
 * *reaches* quota the browser may have already started evicting this origin's cache entries, so the
 * flag needs runway to catch a human's attention before that happens, not just announce it after. */
const STORAGE_WARN_FRACTION = 0.8;

/**
 * @param {object} options
 * @param {import('three').WebGLRenderer} options.renderer Read via `.info` — never mutated.
 * @param {boolean} options.isMobileClass Selects which budget (`DESKTOP_BUDGET`/`MOBILE_BUDGET`)
 *   the panel checks `renderer.info` against — same `isCoarsePointerDevice()` signal
 *   `sceneManager.js` already uses for the chunk-radius split, passed in rather than re-detected
 *   here so both debug/gameplay code agree on one source of truth per boot.
 * @param {HTMLElement} [options.container] Parent element the panel's DOM is appended to. Defaults
 *   to `document.body`.
 * @returns {{active: boolean, update: (delta: number) => void, dispose: () => void}}
 */
export function createPerfPanel({ renderer, isMobileClass, container = document.body }) {
	const budget = isMobileClass ? MOBILE_BUDGET : DESKTOP_BUDGET;

	const el = document.createElement('pre');
	el.className = 'g3d-perf-panel';
	el.hidden = true;
	container.appendChild(el);

	const panel = { active: false };
	let sinceRefresh = 0;
	let fps = 0;

	// Run 66 (ADR-0084): offline storage-quota monitoring. Feature-detected once up front rather
	// than per-call — `navigator.storage`/`.estimate` are either present for the whole session or
	// not (no browser adds/removes the API mid-session).
	const canEstimateStorage = Boolean(navigator.storage && typeof navigator.storage.estimate === 'function');
	let storageLine = canEstimateStorage ? 'Storage: measuring…' : 'Storage: unsupported (no navigator.storage.estimate)';
	// Starts at `Infinity` so the very first `update()` call while active triggers an immediate
	// measurement instead of waiting a full `STORAGE_REFRESH_INTERVAL_SECONDS` for the first number.
	let sinceStorageRefresh = Infinity;
	let storageEstimateInFlight = false;

	/** Re-issues `navigator.storage.estimate()` and updates `storageLine` once it resolves. Guards
	 * against overlapping calls (a slow/stalled estimate() shouldn't pile up repeat requests) and
	 * never throws — a rejected estimate() just shows a "failed" line, same fail-open spirit as
	 * every other gameplay try/catch this project's safe-mode rule (GOVERNANCE.md §8.13) uses. */
	function refreshStorageEstimate() {
		if (!canEstimateStorage || storageEstimateInFlight) return;
		storageEstimateInFlight = true;
		navigator.storage.estimate()
			.then(({ usage = 0, quota = 0 }) => {
				const usageMB = usage / (1024 * 1024);
				const quotaMB = quota / (1024 * 1024);
				const usedFraction = quota > 0 ? usage / quota : 0;
				const warnFlag = usedFraction >= STORAGE_WARN_FRACTION ? ' !' : '';
				storageLine = `Storage: ${usageMB.toFixed(1)} / ${quotaMB.toFixed(0)} MB (${(usedFraction * 100).toFixed(0)}%)${warnFlag}`;
			})
			.catch(() => {
				storageLine = 'Storage: estimate() failed';
			})
			.finally(() => {
				storageEstimateInFlight = false;
			});
	}

	const onKeyDown = (event) => {
		if (event.code !== 'F2') return;
		panel.active = !panel.active;
		el.hidden = !panel.active;
	};
	window.addEventListener('keydown', onKeyDown);

	/**
	 * Call once per frame, *after* `renderer.render()` — `renderer.info.render.calls`/`.triangles`
	 * reset on every `render()` call (`renderer.info.autoReset`, on by default), so reading them
	 * before that frame's render would report the previous frame's numbers, not this one's. A no-op
	 * while inactive (no DOM write, no string formatting) — same "zero-cost when off" contract
	 * `freeCamera.js`'s `update()` follows.
	 * @param {number} delta Seconds since the last frame.
	 */
	panel.update = (delta) => {
		if (!panel.active) return;
		fps = delta > 0 ? 1 / delta : fps;
		sinceRefresh += delta;

		// Storage-estimate polling runs on its own coarser timer, independent of the render-stat
		// throttle's early return below — otherwise it would only ever get checked on the same
		// frames the render stats happen to refresh on.
		sinceStorageRefresh += delta;
		if (sinceStorageRefresh >= STORAGE_REFRESH_INTERVAL_SECONDS) {
			sinceStorageRefresh = 0;
			refreshStorageEstimate();
		}

		if (sinceRefresh < REFRESH_INTERVAL_SECONDS) return;
		sinceRefresh = 0;

		const { render, memory } = renderer.info;
		const drawCallsFlag = render.calls > budget.maxDrawCalls ? ' !' : '';
		const trianglesFlag = render.triangles > budget.maxTriangles ? ' !' : '';
		el.textContent =
			`FPS: ${fps.toFixed(0)}\n` +
			`Draw calls: ${render.calls} / ${budget.maxDrawCalls} (${budget.label})${drawCallsFlag}\n` +
			`Triangles: ${render.triangles.toLocaleString()} / ${budget.maxTriangles.toLocaleString()} (${budget.label})${trianglesFlag}\n` +
			`Geometries: ${memory.geometries}\n` +
			`Textures: ${memory.textures} (GPU objects, not MB — three.js exposes no VRAM byte count)\n` +
			`${storageLine}`;
	};

	/** Removes every listener/DOM node this panel added — memory-leak checklist. */
	panel.dispose = () => {
		window.removeEventListener('keydown', onKeyDown);
		el.remove();
	};

	return panel;
}
