/**
 * Additive realism layer for the procedural aurora sky.
 *
 * This module deliberately keeps the public sky.js contract unchanged. It replaces only the
 * fragment-shader source on the already-created ShaderMaterial before its first compilation, so
 * existing uniforms, lifecycle/disposal, day-night synchronization and offline-PWA behavior stay
 * intact. The effect is deterministic with respect to elapsed visual time and uses no external
 * textures/assets.
 * @module auroraRealism
 */

const REALISTIC_AURORA_FRAGMENT_SHADER = /* glsl */ `
	uniform vec3 uHorizonColor;
	uniform vec3 uZenithColor;
	uniform vec3 uAuroraColorA;
	uniform vec3 uAuroraColorB;
	uniform float uTime;
	uniform float uNightFactor;
	varying vec3 vWorldPosition;

	float auroraHash21(vec2 p) {
		p = fract(p * vec2(123.34, 456.21));
		p += dot(p, p + 45.32);
		return fract(p.x * p.y);
	}

	float auroraNoise(vec2 p) {
		vec2 i = floor(p);
		vec2 f = fract(p);
		float a = auroraHash21(i);
		float b = auroraHash21(i + vec2(1.0, 0.0));
		float c = auroraHash21(i + vec2(0.0, 1.0));
		float d = auroraHash21(i + vec2(1.0, 1.0));
		vec2 u = f * f * (3.0 - 2.0 * f);
		return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
	}

	float auroraFbm(vec2 p) {
		float value = 0.0;
		float amplitude = 0.52;
		mat2 rot = mat2(0.82, -0.57, 0.57, 0.82);
		for (int octave = 0; octave < 5; octave++) {
			value += auroraNoise(p) * amplitude;
			p = rot * p * 2.03 + vec2(13.7, 8.3);
			amplitude *= 0.5;
		}
		return value;
	}

	float curtainBand(vec2 p, float phase, float width, float drift) {
		float slowTime = uTime * drift;
		float broadWarp = auroraFbm(vec2(p.x * 0.48 + phase, slowTime * 0.08 + p.y * 0.18));
		float fineWarp = auroraFbm(vec2(p.x * 1.35 - phase * 0.7, p.y * 0.48 - slowTime * 0.13));
		float center = 0.48 + sin(p.x * 2.35 + phase + slowTime) * 0.105;
		center += (broadWarp - 0.5) * 0.22 + (fineWarp - 0.5) * 0.075;
		float ribbon = 1.0 - smoothstep(width, width + 0.12, abs(p.y - center));
		float verticalStriation = pow(0.5 + 0.5 * sin(p.x * 28.0 + fineWarp * 12.0 + slowTime * 2.1), 4.0);
		float brokenEdge = smoothstep(0.24, 0.78, auroraFbm(vec2(p.x * 2.7 + phase * 2.0, p.y * 1.2 - slowTime * 0.18)));
		return ribbon * mix(0.42, 1.0, verticalStriation) * mix(0.58, 1.0, brokenEdge);
	}

	void main() {
		vec3 dir = normalize(vWorldPosition);
		// The sky sphere follows the player camera, so atmospheric direction must be camera-relative.
		dir = normalize(vWorldPosition - cameraPosition);
		float heightFactor = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
		vec3 skyColor = mix(uHorizonColor, uZenithColor, pow(heightFactor, 0.55));

		float azimuth = atan(dir.z, dir.x) / 6.28318530718 + 0.5;
		float elevation = clamp(dir.y, -0.05, 1.0);
		vec2 curtainUv = vec2(azimuth * 3.0, elevation);

		float horizonFade = smoothstep(0.055, 0.24, elevation);
		float zenithFade = 1.0 - smoothstep(0.86, 1.0, elevation);
		float auroraMask = horizonFade * zenithFade;

		float curtainA = curtainBand(curtainUv, 0.3, 0.115, 0.055);
		float curtainB = curtainBand(curtainUv + vec2(0.42, 0.055), 2.1, 0.09, -0.042);
		float curtainC = curtainBand(curtainUv + vec2(-0.31, 0.12), 4.2, 0.07, 0.031);
		float layeredCurtain = curtainA * 0.72 + curtainB * 0.48 + curtainC * 0.34;

		float slowPulse = 0.86 + 0.14 * sin(uTime * 0.23 + auroraFbm(curtainUv * 0.55) * 6.28318530718);
		float phosphorCore = pow(clamp(layeredCurtain, 0.0, 1.6), 1.32) * slowPulse;
		float softGlow = pow(clamp(curtainA * 0.55 + curtainB * 0.4 + curtainC * 0.3, 0.0, 1.0), 0.62);

		float colorNoise = auroraFbm(vec2(curtainUv.x * 0.78 + uTime * 0.009, curtainUv.y * 0.45 + 5.0));
		vec3 greenCyan = mix(uAuroraColorA, vec3(0.14, 1.0, 0.82), 0.48);
		vec3 violetEdge = mix(uAuroraColorB, vec3(0.62, 0.30, 1.0), 0.38);
		vec3 auroraColor = mix(greenCyan, violetEdge, smoothstep(0.58, 0.94, colorNoise));

		float luminance = (phosphorCore * 0.92 + softGlow * 0.32) * auroraMask * uNightFactor;
		vec3 atmosphericLift = greenCyan * softGlow * auroraMask * uNightFactor * 0.07;
		vec3 finalColor = skyColor + atmosphericLift + auroraColor * luminance;

		gl_FragColor = vec4(finalColor, 1.0);
	}
`;

/**
 * Replaces the aurora material's shader source before WebGL compilation.
 * @param {import('three').ShaderMaterial} material
 * @returns {import('three').ShaderMaterial}
 */
export function applyRealisticAuroraMaterial(material) {
	material.fragmentShader = REALISTIC_AURORA_FRAGMENT_SHADER;
	material.needsUpdate = true;
	material.userData.realisticAurora = true;
	return material;
}
