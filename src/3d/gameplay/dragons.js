/**
 * Flying dragons (FAZ 7) — the subsystem's public entry point, and the only path any other module
 * (or smoke check) imports. Runs 53-71 built the whole feature here as one file; run 71 split it by
 * subsystem block when it reached 598/600 lines, a real forcing signal under GOVERNANCE.md Altın
 * Kural 7 (DECISIONS.md ADR-0092). The split is internal only: `createDragon` and
 * `spawnConfiguredDragons` are still exported from this exact path with identical behavior, so no
 * caller — `game3d.js`, the six dragon smoke checks, `service-worker.js`'s precache list — changed.
 *
 * Where the code now lives:
 * - `gameplay/dragonController.js` — `createDragon`: model/rig loading, the per-frame flight +
 *   reaction update loop (notice/reactive/dive/pursuit/give-up), and `dispose()`.
 * - `gameplay/dragonFlightMath.js` — the pure, stateless circle/blend arithmetic that loop drives
 *   (blend easing, circle pose, center travel, dive offset, terrain-safety clamp).
 * - `gameplay/dragonSpawns.js` — `spawnConfiguredDragons`: resolving `DRAGON_CONFIG.SPAWNS` against
 *   the kingdom-seat lookup, the same spawn-wiring shape `animals.js`/`npc.js` already use.
 *
 * How the flight behavior got here (kept at the entry point every other module and doc already
 * points at, rather than in whichever file the code currently sits in):
 * First pass (run 53): a single dragon circling at a fixed altitude above a kingdom seat, looping
 * its real `Fly` animation clip — no rig/animation work needed since
 * `DRAGON_CONFIG.MODEL_URL` (`black_dragon`, Free3D) already ships a skeleton + baked clips, unlike
 * the unrigged Meshy/Hitem3d reference dragons (see `gameplayConfig.js`'s `DRAGON_CONFIG` doc
 * comment and DECISIONS.md ADR-0071). Deliberately the smallest thing that reads as "a dragon
 * patrols the sky": a closed circular path at constant altitude, no ground collision, no
 * pathfinding — same scope discipline `gameplay/animals.js`'s first straight-line patrol pass set
 * for FAZ 6. Run 54 (DECISIONS.md ADR-0072) adds the first player-awareness: an edge-triggered
 * one-shot "notice" event through the shared `EventBus` when the player enters `noticeRadiusMeters`
 * of the dragon's real, current 3D position — the flight path itself is still untouched by it (no
 * diving/chasing/fleeing), same "awareness before behavior change" order FAZ 6's wolves went
 * through (flee trigger existed before pack-alert). Run 58 (DECISIONS.md ADR-0077) adds the actual
 * behavior change on top of that awareness: while the player stays inside `noticeRadiusMeters`, the
 * circle itself doesn't change (still no diving/chasing/pathfinding — that's a bigger future step),
 * but the dragon eases into flying its existing circle faster and banking harder, then eases back to
 * the calm baseline once the player leaves — a smoothly-blended "reaction", not an instant snap, and
 * still fully deterministic (driven only by `isInRadius` + elapsed `delta`, no `Math.random()`).
 * Run 64 (DECISIONS.md ADR-0082) adds the first real path deviation: a brief dive off the circle
 * when the player gets much closer than `noticeRadiusMeters` (a new, smaller `alarmRadiusMeters`),
 * swooping partway toward them and losing altitude, then easing back onto the ordinary circle once
 * they back off — blended the same linear-ease way as run 58's speed/bank reaction, just applied to
 * *position* this time, and terrain-safe (never dips below the real ground under it, plus a
 * clearance margin). Still no chasing/attacking/pathfinding back — the circle (`angle`) is never
 * actually left, only how far the rendered position is pulled off it, so "returning to the circle"
 * needs no separate path-planning: easing the dive blend back to 0 always lands exactly on the
 * ordinary circling pose.
 * Run 66 (DECISIONS.md ADR-0085) adds the real continuous chase runs 64/65 both flagged as the
 * natural next increment: instead of pulling the dragon a bounded fraction off a circle that stays
 * anchored to its home seat forever, the *circle itself* now travels — its center moves toward the
 * player at a bounded speed (`pursuitCenterSpeedMps`) while engaged, tightening its radius and
 * following terrain altitude as it goes, then travels back home the same way once the dragon
 * disengages. That keeps every property this module's earlier passes were built around (the dragon
 * is always exactly on a well-defined circle, so "return home" needs no path-planning, and every
 * value is still a pure function of `delta` + the player's position, so it stays deterministic)
 * while removing the one thing that made the dive stop short of a real chase: the dragon can now
 * actually reach the player, anywhere in the world, instead of being permanently tethered to its
 * seat. Engagement is time-boxed (`pursuitMaxSeconds`) and re-arms only after the player leaves
 * `pursuitRadiusMeters`, the same edge-trigger shape the notice event already uses — so a dragon
 * harries the player and then breaks off, rather than following them across the map forever.
 * `game3d.js` wires this in the same spawn-then-per-frame-update shape every other gameplay system
 * already uses, wrapped in a try/catch (GOVERNANCE.md §8.13 safe mode) since run 64 also touches
 * that call site.
 * Run 70 (DECISIONS.md ADR-0089) adds a small, deliberately damage-free polish pass on top of run
 * 66's chase: the `Fly` clip's own playback speed now reacts too, not just position/bank/circling
 * speed — the more agitated the dragon is (reusing the existing reactive/dive/pursuit blends,
 * whichever is currently strongest), the harder its wings visibly flap, easing back to the calm
 * baseline the same way every earlier reaction here already does. Purely cosmetic — no new radius,
 * trigger, or state, and still no health/damage/attack (see `QUESTIONS_FOR_OWNER.md`'s open
 * question on whether this project wants one at all).
 * Run 71 (DECISIONS.md ADR-0091) gives the *end* of an engagement its own distinct read, the same
 * way run 70 gave its escalation one: run 66's `pursuitExhausted` flag (set once a chase burns
 * through `pursuitMaxSeconds` while the player is still inside `pursuitRadiusMeters`) already
 * distinguishes "gave up on a timer" from an ordinary disengage (the player simply outran/outlasted
 * the radius before the timer ever ran out — `pursuitExhausted` never becomes true in that case at
 * all). Until now both cases eased the circle back home through identical bank-angle math, so a
 * player could never actually tell which one happened. A new `giveUpBlend` — eased toward 1 only
 * while `pursuitExhausted` is true, back to 0 once the player finally leaves the radius and re-arms
 * it — now steepens the bank angle a beat further, over its own (deliberately snappier) transition
 * time, layered on top of whatever the existing reactive-blend bank already is. Still no new
 * position/radius/trigger and still no health/damage/attack.
 * Run 72 gives the *start* of a dive its own beat, the same way run 71 gave its end one: previously
 * `diveBlend` (and the wing-flap agitation it drives) began moving the instant the player crossed
 * `alarmRadiusMeters`, so the swoop and its own warning were the same motion. A new
 * `diveTelegraphBlend` now rises immediately on crossing that threshold, driving the wing-flap cue
 * on its own, while `diveBlend` itself stays pinned at exactly 0 (the dragon holds its circling
 * pose) for `diveTelegraphSeconds` (default 0.4s). Only once that window elapses does the dive's own
 * position blend start moving, exactly as before. A player who retreats during the telegraph window
 * never sees the dive start at all -- only the wing-flare warning fired, the intended "warned, not
 * committed" read. Still no new radius/trigger and still no health/damage/attack.
 * Run 90 (DECISIONS.md ADR-0116) answers the question every one of runs 66/70/71 explicitly deferred
 * to `QUESTIONS_FOR_OWNER.md`: the project owner asked, in their own words, for dragons to actually
 * be aggressive where they exist, attacking once provoked. A new `attackBlend` escalates the
 * existing dive once the player has stayed inside `alarmRadiusMeters` continuously for *longer* than
 * the ordinary dive's own telegraph+transition window (`attackTriggerSeconds`, default 2.5s beyond
 * that) — the player kept provoking it, not merely triggered one swoop — replacing the dive's calm
 * lateral-pull/altitude-drop with much more committed ones (`attackLateralPullFraction`/
 * `attackDropMeters`) over its own slower transition. Once fully escalated and within
 * `biteRadiusMeters` of the player's *real*, terrain-clamped position, the dragon emits
 * `EVENTS.PLAYER_DAMAGED` (a fixed `biteDamage`, rate-limited by `biteCooldownSeconds`) — the
 * project's first source of real, lethal-eventually damage of any kind. `gameplay/health.js` (a new,
 * fully generic health-state module, not dragon-specific) turns that into the player's actual health
 * dropping, `ui/healthBar.js` shows it, and `game3d.js` handles `EVENTS.PLAYER_DIED` by respawning
 * the player at their spawn point, fully healed. Entirely additive and off by default: a dragon with
 * no `biteEventName`/`biteDamage` configured (every dragon spawned before this run, since
 * `DRAGON_CONFIG.SPAWNS[0]` is the only one updated to opt in) never computes any of this and
 * behaves exactly as it did the run before — see `dragonController.js`'s own `canBite` gate.
 *
 * @module gameplay/dragons
 */

export { createDragon } from './dragonController.js';
export { spawnConfiguredDragons } from './dragonSpawns.js';
