# Run221 Aurora Visual Calibration RCA

## Scope

Owner requested a brighter gameplay night and a realistic, phosphorescent, animated aurora that must not read as artificial neon/disco lighting. Canonical gameplay day/night semantics must remain intact.

## Observed calibration failures

1. First procedural realism pass was quantitatively bright and animated, but visual review showed broad neon-like luminous blobs. It was not published.
2. Natural-curtain refinement removed the blobs. Its first calibration became too sparse (`brightFraction ~= 0.0004167`), then a widened calibration passed quantitative gates but visual review showed mechanically parallel/evenly spaced horizontal ribbon arcs. It was not published.
3. V3 ray-curtain refinement replaces parallel ribbons with one irregular lower auroral edge, vertically stretched rays and a faint secondary curtain. The first V3 browser measurement rendered too dark (`averageLuminance ~= 7.8449`, required `> 9`) and therefore did not reach the normal screenshot step.

## Root cause

The browser proof originally captured its PNG only after quantitative assertions. That is good for final acceptance but poor for visual RCA: a shader can fail a luminance threshold before we get the image needed to decide whether the correct repair is sky lift, aurora emission, curtain coverage, or scene lighting.

The repeated failures are visual-calibration failures rather than deterministic-world, gameplay, PWA, or syntax failures. Canonical night semantics and source-line additive guards have remained intact.

## Corrective action

- Keep the strict acceptance thresholds unchanged.
- Add a separate diagnostic WebGL capture that always saves two frames and prints luminance/bright/phosphor/animation metrics before any aesthetic threshold is applied.
- Inspect the diagnostic PNG before tuning V3 again.
- Prefer raising the dark-night atmospheric floor and/or auroral ray energy only as much as the captured V3 frame demonstrates is necessary; do not return to broad blob masks or parallel stacked ribbons.
- Re-run the full canonical workflow after the diagnostic-guided adjustment. No merge until the quantitative gates and manual visual review both pass.

## Prevention

Future shader calibration work should use two layers of evidence:

1. non-blocking diagnostic capture for RCA and visual review;
2. blocking acceptance proof for thresholds, console/HTTP cleanliness, PWA/cache, performance, determinism, technical debt, additive-only and concurrency.
