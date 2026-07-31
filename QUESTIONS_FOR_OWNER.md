# QUESTIONS_FOR_OWNER.md

Per `GOVERNANCE.md` §14: a real design/product decision logged here (with a temporary default)
instead of guessed at silently. Newest entry at the bottom.

- **(run 55, ADR-0075) What ground slope should count as "too steep to walk" for kingdom seats /
  future terrain features?** No code in this project enforces a walkable-slope limit yet
  (`physics.js`'s ground-height snap follows terrain regardless of steepness), so there was no
  existing project-defined value to reuse for `scripts/terrainSeatSafetyCheck.js`'s "gidilemez
  eğim" check. **Temporary default used:** 35° (stricter than Unity's default
  `CharacterController.slopeLimit`, 45°, and Unreal's default `WalkableFloorAngle`, ~44.7°). Revisit
  once real slope-based movement restriction (or a real playtest) exists to calibrate against.

- **(run 56, ADR-0076) What grade should a cart road refuse to comfortably climb — how much
  gentler than run 55's 35° foot-walkable default?** No existing project value answers "what's too
  steep for a horse-drawn cart" as distinct from "too steep for a person on foot". **Temporary
  defaults used:** `world/roadPathfinder.js`'s `ROAD_COMFORT_GRADE_DEGREES = 10°` (soft cost-curve
  target the A* search is biased toward) and `scripts/roadNetworkSafetyCheck.js`'s
  `ROAD_HARD_MAX_GRADE_DEGREES = 20°` (hard failure ceiling) — both this run's own engineering
  judgment (within this task's own suggested 15-20° range for the hard ceiling), not derived from
  real-world civil-engineering grade standards (which run steeper-terrain gamified worlds like this
  one don't really map onto directly). Revisit once a real cart/wagon vehicle (FAZ 6) exists to
  calibrate against actual vehicle physics, or if a human playtester finds a specific road segment
  reads as implausibly steep.

- **(run 56, ADR-0076) Is a second, thinner "patika" (footpath) road tier wanted, or is the single
  "at arabası yolu" (cart road) tier sufficient for now?** GOVERNANCE.md §18 item 2 names both; this
  run shipped only the wider cart-road tier (see ADR-0076's Decision point 3) since it was enough to
  prove routing/connectivity, and a second tier is a real, non-trivial follow-up (a second geometry
  pass plus a design call about *which* connections get the thinner tier — every edge, or only
  short/local ones like `olena`<->`berk`?). **Temporary default used:** single tier, deferred second
  tier noted in `3D_GAME_PROGRESS.md`'s "Next step". Revisit if/when a real product need for the
  visual distinction comes up (e.g. a future quest or NPC dialogue that references "the footpath"
  specifically).
