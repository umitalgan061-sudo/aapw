/**
 * How flowing water *looks*: the foam streaks and the speeds that drive them.
 *
 * Separated from `world/rivers.js` (run 394) because the course, the ribbon geometry and the surface
 * appearance are three different concerns, and the appearance policy is the one that keeps changing
 * as renders get looked at. Everything here is a tuning constant with its measurement written down;
 * `attachFlowAnimation` in `rivers.js` is what consumes them.
 * @module world/riverFlowAppearance
 */

/** Flow speed, in m/s, of the foam pattern over a perfectly flat reach. Not a physical current
 * measurement — the speed the *visual* streaks travel at, tuned so a still-looking pool still reads
 * as moving water. */
export const RIVER_BASE_FLOW_SPEED_MPS = 1.2;

/** How much the local bed gradient adds to that speed, via `sqrt(grade)`. The square root (rather
 * than a linear term) is the shape open-channel flow actually follows — Manning/Chézy both give
 * velocity proportional to the square root of the slope — so steep sections speed up markedly while
 * the near-flat majority stays calm, instead of everything scaling together. */
export const RIVER_GRADE_FLOW_GAIN = 6;

/** Spatial frequency of the foam streaks, in radians per meter — 1.0 gives ~6.3m between crests,
 * about two streaks per river width at the default 14m. An earlier 0.35 (~18m) was tried and rejected
 * on close-range evidence: at one streak per two river widths the pattern read as a single drifting
 * blob rather than moving water. The streaks are evaluated per fragment from an interpolated arc
 * length, so this is independent of how far apart the traced path points are. */
export const RIVER_FLOW_WAVENUMBER = 1.0;

/** Waterfall curtains fall much faster than the river flows, and their drop is short, so they get
 * their own fixed speed rather than a gradient-derived one. */
export const WATERFALL_FLOW_SPEED_MPS = 9;

/**
 * Bed speeds, in m/s, over which foam ramps from none to full white water (run 394).
 *
 * White water is made by the bed, not by the clock: a river froths where it runs fast and broken, and
 * lies smooth where it does not. Foam used to be applied at one strength along the whole course,
 * which put evenly spaced transverse bands down even the calmest reach — measured off a render, a
 * Michelson contrast of 0.25 repeating every ~40 px, which reads as a barcode rather than as water.
 *
 * `aFlowSpeed` already carries the local bed gradient, so the froth now follows it. Against this
 * course's measured spread (1.20 / median 4.39 / 7.44 m/s) the median reach keeps about a quarter of
 * the old foam and the steep reaches keep all of it. Waterfall curtains run at a fixed
 * `WATERFALL_FLOW_SPEED_MPS`, well past the top of this ramp, so they stay fully white — which is
 * what a waterfall is.
 */
export const FROTH_SPEED_MIN_MPS = 3.0;
export const FROTH_SPEED_FULL_MPS = 6.5;
