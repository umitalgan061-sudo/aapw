/**
 * Accessibility presentation policy for the 3D runtime.
 *
 * The game already has multiple visual systems capable of motion, camera shake, animated sky effects,
 * particles and HUD transitions. This policy centralizes preference-aware limits without taking over
 * those systems. Callers consume the immutable result and remain responsible for applying it.
 */

const MOTION_LEVELS = Object.freeze({ FULL: 'full', REDUCED: 'reduced' });
const CONTRAST_LEVELS = Object.freeze({ NORMAL: 'normal', HIGH: 'high' });
const MAX_MOTION_SCALE = 1;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function bool(value) { return value === true; }

function inferPreference({ reducedMotion, highContrast, media }) {
	return {
		reducedMotion: reducedMotion ?? Boolean(media?.('(prefers-reduced-motion: reduce)')),
		highContrast: highContrast ?? Boolean(media?.('(prefers-contrast: more)')),
	};
}

function freeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
}

export function createAccessibilityPolicy(input = {}) {
	const media = input.media ?? (typeof window !== 'undefined' ? (query) => window.matchMedia?.(query)?.matches ?? false : null);
	const preference = inferPreference({ ...input, media });
	const reducedMotion = bool(preference.reducedMotion);
	const highContrast = bool(preference.highContrast);
	const userMotionScale = Number.isFinite(input.userMotionScale) ? clamp(input.userMotionScale, 0, 1) : 1;
	const motionScale = reducedMotion ? Math.min(userMotionScale, 0.15) : userMotionScale;
	return freeze({
		version: 1,
		motion: {
			level: reducedMotion ? MOTION_LEVELS.REDUCED : MOTION_LEVELS.FULL,
			scale: motionScale,
			maxCameraShakeAmplitude: reducedMotion ? 0 : 1,
			maxCameraShakeDurationMs: reducedMotion ? 0 : 220,
			maxTransitionMs: reducedMotion ? 80 : 420,
			allowAnimatedBackgrounds: !reducedMotion,
			allowWindAnimation: !reducedMotion,
		},
		readability: {
			contrast: highContrast ? CONTRAST_LEVELS.HIGH : CONTRAST_LEVELS.NORMAL,
			backgroundLumaFloor: highContrast ? 0.2 : 0.12,
			minTextScale: highContrast ? 1.05 : 1,
			focusOutlineRequired: highContrast,
		},
		announcements: {
			repeatedEventsSuppressed: reducedMotion,
			maxAnnouncementRatePerSecond: reducedMotion ? 1 : 2,
		},
	});
}

export function scaleAnimationDuration(durationMs, policy) {
	if (!Number.isFinite(durationMs)) return 0;
	const cap = policy?.motion?.level === MOTION_LEVELS.REDUCED ? 80 : 2000;
	return clamp(durationMs * (policy?.motion?.scale ?? MAX_MOTION_SCALE), 0, cap);
}

export function scaleCameraShake(amplitude, policy) {
	if (!Number.isFinite(amplitude)) return 0;
	const max = policy?.motion?.maxCameraShakeAmplitude ?? 1;
	return clamp(amplitude, -max, max) * (policy?.motion?.scale ?? 1);
}

export function accessibilityPolicyConstants() {
	return freeze({ motionLevels: MOTION_LEVELS, contrastLevels: CONTRAST_LEVELS });
}
