/**
 * Runtime-facing P5 environment quality adoption.
 * Keeps canonical terrain/hydrology/collider ownership external while ensuring
 * the shipped scene cannot fall back to an unreadable black atmospheric state.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function finiteOr(value, fallback) {
	return Number.isFinite(value) ? value : fallback;
}

export function applyEnvironmentVisualQualityRuntime({ scene, renderer, camera, fog, renderQuality } = {}) {
	if (!scene || !renderer || !camera) {
		return Object.freeze({ applied: false, reason: 'missing-runtime-owner' });
	}

	const preset = renderQuality?.preset ?? {};
	const mobile = Boolean(renderQuality?.isMobile || preset.pixelRatioCap <= 1.5);
	const exposure = clamp(finiteOr(preset.exposure, 1.0), 0.8, 1.35);
	const farPlane = clamp(finiteOr(camera.far, 2000), 500, 100000);
	const horizonLumaFloor = mobile ? 0.075 : 0.065;
	const current = scene.background?.isColor ? scene.background : null;
	const background = current ?? { r: 0.08, g: 0.06, b: 0.05 };
	const luma = 0.2126 * finiteOr(background.r, 0.08) + 0.7152 * finiteOr(background.g, 0.06) + 0.0722 * finiteOr(background.b, 0.05);

	if (luma < horizonLumaFloor && scene.background?.setRGB) {
		const scale = horizonLumaFloor / Math.max(luma, 0.0001);
		scene.background.setRGB(
			clamp(background.r * scale, 0.08, 0.24),
			clamp(background.g * scale, 0.06, 0.18),
			clamp(background.b * scale, 0.05, 0.16),
		);
	}

	if (fog?.color?.setRGB) {
		const fogLuma = 0.2126 * finiteOr(fog.color.r, 0.35) + 0.7152 * finiteOr(fog.color.g, 0.41) + 0.0722 * finiteOr(fog.color.b, 0.48);
		if (fogLuma < horizonLumaFloor) {
			fog.color.setRGB(0.35, 0.41, 0.48);
		}
		fog.near = clamp(finiteOr(fog.near, farPlane * 0.18), 25, farPlane * 0.55);
		fog.far = clamp(finiteOr(fog.far, farPlane * 0.92), fog.near + 50, farPlane);
	}

	if ('toneMappingExposure' in renderer) renderer.toneMappingExposure = exposure;
	if (camera.userData) {
		camera.userData.environmentVisualQuality = Object.freeze({
			cameraRelativeSky: true,
			blackSkyGuard: true,
			farPlane,
			horizonLumaFloor,
		});
	}
	if (scene.userData) {
		scene.userData.environmentVisualQuality = Object.freeze({
			version: 'v25',
			mobileBudget: mobile,
			atmosphere: 'camera-relative-bounded',
			canonicalMutation: false,
		});
	}

	return Object.freeze({
		applied: true,
		mobile,
		exposure,
		farPlane,
		horizonLumaFloor,
		blackSkyGuard: true,
	});
}
