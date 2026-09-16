/** Output-device profile policy for speakers, headphones and constrained mobile speakers. */

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export const AUDIO_OUTPUT_PROFILES = Object.freeze({
	SPEAKER: 'speaker',
	HEADPHONES: 'headphones',
	MOBILE: 'mobile',
});

export function resolveAudioOutputProfile({ output = AUDIO_OUTPUT_PROFILES.SPEAKER, channels = 2 } = {}) {
	const profile = Object.values(AUDIO_OUTPUT_PROFILES).includes(output) ? output : AUDIO_OUTPUT_PROFILES.SPEAKER;
	const safeChannels = Math.max(1, Math.min(2, Math.round(Number.isFinite(channels) ? channels : 2)));
	const config = {
		[AUDIO_OUTPUT_PROFILES.SPEAKER]: { bass: 0.92, treble: 0.82, spatialWidth: 0.72, centerBoost: 0.04 },
		[AUDIO_OUTPUT_PROFILES.HEADPHONES]: { bass: 0.96, treble: 0.9, spatialWidth: 1, centerBoost: 0 },
		[AUDIO_OUTPUT_PROFILES.MOBILE]: { bass: 0.72, treble: 0.76, spatialWidth: 0.48, centerBoost: 0.09 },
	}[profile];
	return Object.freeze({
		version: 1,
		profile,
		channels: safeChannels,
		bass: clamp(config.bass, 0.4, 1),
		treble: clamp(config.treble, 0.4, 1),
		spatialWidth: clamp(config.spatialWidth, 0, 1),
		centerBoost: clamp(config.centerBoost, 0, 0.2),
		monoCompatible: safeChannels === 1 || profile === AUDIO_OUTPUT_PROFILES.MOBILE,
	});
}

export function validateAudioOutputProfile(profile) {
	return Boolean(profile?.version === 1 && Object.values(AUDIO_OUTPUT_PROFILES).includes(profile.profile) && profile.channels >= 1 && profile.channels <= 2 && profile.spatialWidth >= 0 && profile.spatialWidth <= 1);
}
