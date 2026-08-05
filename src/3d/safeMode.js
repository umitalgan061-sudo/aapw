/**
 * safeMode.js — GOVERNANCE.md §8.13 ("Hata Sınırı / Güvenli Mod") helpers, extracted from
 * `game3d.js`'s `tick()` (run 82, DECISIONS.md ADR-0105).
 *
 * The rule: if one gameplay subsystem's per-frame `update()` throws, only that subsystem is logged
 * and disabled — the rest of the game keeps running rather than the whole frame loop dying. Run 64
 * first applied it to dragons; run 81 (ADR-0104) extended it to the other 3 subsystems the rule
 * names (NPC AI, animal AI, dialogue/interaction, world events). That left `game3d.js` carrying
 * five near-identical try/catch blocks inline — 5 copies of the same ~10 lines differing only in a
 * noun — and pushed the file to 571/600, close enough to this project's file cap (Altın Kural 7)
 * that `checkSmokeCheckRegistry.js` began warning about it.
 *
 * Two shapes, because the subsystems genuinely come in two shapes — this is not one abstraction
 * awkwardly covering both:
 * - **Per-entity lists** (`state.npcs`, `state.animals`, `state.dragons`): many independent
 *   entities, each owning a scene object and a `dispose()`. One failing entity is removed from the
 *   scene, disposed, and dropped from the list; its siblings keep updating. → `updateEntitiesSafely`
 * - **Singletons** (`state.interaction`, `state.worldEvents`): one shared controller with no list to
 *   filter and (for `interaction`) no scene object of its own. A failure latches a caller-held
 *   boolean so the call is *skipped entirely* on every later frame — not retried and re-caught,
 *   which would spam the console once per frame forever on a persistent bug. → `updateSystemSafely`
 *
 * Both keep state ownership in the caller (`game3d.js` still owns `state.npcs` and the disabled
 * flags) — these helpers return the new value rather than mutating `state`, so there is exactly one
 * place per subsystem where its lifetime is visible.
 * @module safeMode
 */

/** Shared tail of every safe-mode console message — the one place the rule reference lives. */
const SAFE_MODE_NOTE = '(GOVERNANCE.md §8.13 safe mode), rest of the game continues.';

/**
 * Updates every entity in a per-entity gameplay list, isolating failures to the single entity that
 * threw. Used for NPCs, animals, and dragons — all three share the same
 * `{object3D, update(...), dispose()}` contract (see `gameplay/npc.js`'s `createNPC`).
 *
 * A throwing entity is logged, removed from the scene, disposed, and excluded from the returned
 * list; it is never updated again. Every other entity in the list still updates this same frame,
 * including ones after the failing entry.
 *
 * @param {object} options
 * @param {Array<{object3D: import('three').Object3D, dispose: () => void}>} options.entities The
 *   current list. Never mutated — a filtered copy is returned only when something actually failed.
 * @param {import('three').Scene} options.scene Scene to remove a failed entity's `object3D` from.
 * @param {string} options.label Human-readable kind for the log line, e.g. `'NPC'` / `'Dragon'`.
 * @param {(entity: object) => void} options.update Calls the entity's own `update()` with whatever
 *   per-frame arguments that subsystem takes (delta, player position, packmate positions, ...).
 * @returns {Array<object>} `entities` unchanged when nothing threw (the overwhelmingly common case,
 *   so no allocation on a healthy frame), otherwise a new list without the failed entities.
 */
export function updateEntitiesSafely({ entities, scene, label, update }) {
	let anyFailed = false;
	for (const entity of entities) {
		try {
			update(entity);
		} catch (error) {
			console.error(
				`[game3d] ${label} "${entity.object3D?.name ?? '?'}" update() threw — disabling this one only ${SAFE_MODE_NOTE}`,
				error,
			);
			scene.remove(entity.object3D);
			entity.dispose();
			entity.disabledDueToError = true;
			anyFailed = true;
		}
	}
	return anyFailed ? entities.filter((entity) => !entity.disabledDueToError) : entities;
}

/**
 * Updates a singleton gameplay system, latching it off permanently (for this session) if it throws.
 * Used for the interaction/dialogue controller and the world-event system.
 *
 * Unlike {@link updateEntitiesSafely} there is no list to filter and — for `interaction` — no scene
 * object to remove, so "disabled" is expressed as a boolean the caller stores and passes back in.
 * Once disabled, `update` is not called again at all.
 *
 * @param {object} options
 * @param {boolean} options.disabled Current disabled state, as returned by an earlier call. When
 *   `true` this is a no-op that simply returns `true` again.
 * @param {string} options.label Human-readable system name for the log line, e.g.
 *   `'World-event system'`.
 * @param {() => void} options.update Calls the system's own `update()` with its per-frame arguments.
 * @param {(() => void)} [options.disposeOnError] Optional cleanup run once, on the failing frame
 *   only — for a system that owns a timer/countdown or similar (`worldEvents`). Omit for a system
 *   that owns nothing to release (`interaction`). Must be safe to call even if the system's own
 *   `dispose()` is later called again by `game3d.js`'s teardown path (both current implementations
 *   are idempotent).
 * @returns {boolean} The new disabled state — `true` once this system has thrown, else `disabled`.
 */
export function updateSystemSafely({ disabled, label, update, disposeOnError }) {
	if (disabled) return true;
	try {
		update();
		return false;
	} catch (error) {
		console.error(
			`[game3d] ${label} update() threw — disabling it for the rest of this session ${SAFE_MODE_NOTE}`,
			error,
		);
		if (disposeOnError) disposeOnError();
		return true;
	}
}
