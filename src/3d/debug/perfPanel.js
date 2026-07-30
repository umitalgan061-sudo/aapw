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
			`Textures: ${memory.textures} (GPU objects, not MB — three.js exposes no VRAM byte count)`;
	};

	/** Removes every listener/DOM node this panel added — memory-leak checklist. */
	panel.dispose = () => {
		window.removeEventListener('keydown', onKeyDown);
		el.remove();
	};

	return panel;
}
