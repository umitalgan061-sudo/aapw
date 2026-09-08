# Buzul Muhafızı — Snow Relief Director v4

## Purpose

This slice addresses the persistent northwest snow visual debt without changing canonical geography. The director consumes already-authoritative snow amount, local slope, four-neighbour wind exposure, concavity, ridge exposure, moisture and shoreline distance, then emits bounded render-facing material weights.

## What changes visually

- Windward ridge shoulders read as compacted snow slab and crust rather than a uniform white plane.
- Lee bowls and moderate sheltered faces retain deeper, warmer powder and accumulated drift.
- Firn and glacial continuity remain visible in permanent-ice terrain without flattening all snow into the same tone.
- Near-cliff surfaces suppress loose accumulation and reveal rock/scree response.
- Shore-adjacent snow is softened by distance-aware suppression instead of a hard white shoreline halo.
- Deterministic macro/micro breakup varies tone across world-space coordinates while remaining stable across chunk boundaries.

## Invariants

- `terrain.js` remains the height and chunk authority.
- `terrainBiomeShading.js` remains canonical snow coverage authority.
- Hydrology, coast, roads, settlements and colliders are untouched.
- No procedural cone/cube/tree/rock assets are introduced.
- No second material or placement pipeline is introduced.
- The response is bounded, finite, immutable and fail-closed.

## Acceptance

The dedicated workflow requires exact-main ancestry, a changed-line budget not exceeding 3000, syntax, deterministic field checks, browser import of the shipped ES module and final freshness. The browser probe covers windward, lee, cliff, field uniqueness and page/console errors.

## Follow-up visual gates

This slice is intentionally narrow. It does not claim full-world completion. The next environment slice should use the same deterministic cameras to inspect the live framebuffer for:

1. visible rectangular water or chunk seams;
2. mountain wall and stepped coast residuals;
3. vegetation cluster density and asset-first fidelity;
4. water moire/stripe residuals;
5. mobile draw-call and texture-memory budget.
