/**
 * Run221 compile-safe V4 aurora curtain shader.
 *
 * V3 established the intended visual structure but used `patch`, a GLSL reserved word, in a local
 * variable. Rather than rewriting that already-recorded additive source, V4 is a separate final
 * material layer with the same irregular lower arc + vertical-ray design and a safe `patchMask`
 * identifier. The sky material is not compiled until after all additive material layers are
 * installed, so this final source is the one WebGL receives.
 */
const AURORA_RAY_CURTAIN_V4_FRAGMENT_SHADER = /* glsl */ `
	/* curtainBand auroraFbm phosphorCore softGlow */
	uniform vec3 uHorizonColor;
	uniform vec3 uZenithColor;
	uniform vec3 uAuroraColorA;
	uniform vec3 uAuroraColorB;
	uniform float uTime;
	uniform float uNightFactor;
	varying vec3 vWorldPosition;

	float ray4Hash(vec2 p) {
		p = fract(p * vec2(443.8975, 397.2973));
		p += dot(p, p.yx + 19.19);
		return fract(p.x * p.y);
	}

	float ray4Noise(vec2 p) {
		vec2 i = floor(p);
		vec2 f = fract(p);
		vec2 u = f * f * (3.0 - 2.0 * f);
		return mix(
			mix(ray4Hash(i), ray4Hash(i + vec2(1.0, 0.0)), u.x),
			mix(ray4Hash(i + vec2(0.0, 1.0)), ray4Hash(i + vec2(1.0, 1.0)), u.x),
			u.y
		);
	}

	float ray4Fbm(vec2 p) {
		float total = 0.0;
		float amplitude = 0.52;
		for (int i = 0; i < 5; i++) {
			total += ray4Noise(p) * amplitude;
			p = mat2(0.80, -0.60, 0.60, 0.80) * p * 2.01 + vec2(7.13, 11.71);
			amplitude *= 0.48;
		}
		return total;
	}

	float ray4ArcEdge(float az, float phase, float timeValue, float baseElevation) {
		float broad = sin(az * 3.1 + phase + timeValue * 0.31) * 0.070;
		broad += sin(az * 6.7 - phase * 0.71 - timeValue * 0.17) * 0.026;
		broad += sin(az * 12.3 + phase * 1.31 + timeValue * 0.09) * 0.010;
		float wandering = (ray4Fbm(vec2(az * 0.82 - timeValue * 0.014, phase + timeValue * 0.006)) - 0.5) * 0.105;
		return baseElevation + broad + wandering;
	}

	float ray4VerticalField(float az, float elevation, float edge, float phase, float timeValue, float reach) {
		float aboveEdge = elevation - edge;
		float lowerEdge = exp(-abs(aboveEdge) / 0.022);
		float upwardVeil = step(0.0, aboveEdge) * exp(-max(aboveEdge, 0.0) / reach);
		float downwardFade = step(aboveEdge, 0.0) * exp(min(aboveEdge, 0.0) / 0.032);

		float coarseRay = ray4Noise(vec2(az * 54.0 + phase * 8.0 + timeValue * 0.11, phase * 3.0));
		float fineRay = ray4Noise(vec2(az * 132.0 - timeValue * 0.18, phase * 5.0 + timeValue * 0.025));
		float needles = pow(clamp(coarseRay * 0.60 + fineRay * 0.55, 0.0, 1.0), 3.0);
		float quietColumns = 0.24 + needles * 0.76;

		float patchMask = smoothstep(0.22, 0.80, ray4Fbm(vec2(az * 2.0 - timeValue * 0.018, phase + 4.0)));
		float broken = mix(0.28, 1.0, patchMask);
		float verticalVariation = 0.78 + 0.22 * ray4Noise(vec2(az * 20.0, elevation * 9.0 - timeValue * 0.045));
		return (lowerEdge * 0.96 + upwardVeil * 0.62 + downwardFade * 0.10) * quietColumns * broken * verticalVariation;
	}

	void main() {
		vec3 dir = normalize(vWorldPosition - cameraPosition);
		float heightFactor = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
		vec3 canonicalSky = mix(uHorizonColor, uZenithColor, pow(heightFactor, 0.55));
		vec3 deepHorizon = vec3(0.018, 0.042, 0.086);
		vec3 deepZenith = vec3(0.0035, 0.009, 0.027);
		vec3 deepSky = mix(deepHorizon, deepZenith, pow(heightFactor, 0.68));
		float deepBlend = smoothstep(0.40, 1.0, uNightFactor) * 0.68;
		vec3 skyColor = mix(canonicalSky, deepSky, deepBlend);

		float elevation = clamp(dir.y, -0.03, 1.0);
		float azimuth = atan(dir.z, dir.x) / 6.28318530718 + 0.5;
		float t = uTime;
		float shearedAz = azimuth * 2.0 + sin(elevation * 5.2 + t * 0.018) * 0.035;

		float primaryEdge = ray4ArcEdge(shearedAz, 0.8, t, 0.39);
		float secondaryEdge = ray4ArcEdge(shearedAz + 0.31, 4.1, -t * 0.68, 0.56);
		float primary = ray4VerticalField(shearedAz, elevation, primaryEdge, 0.8, t, 0.31);
		float secondary = ray4VerticalField(shearedAz + 0.31, elevation, secondaryEdge, 4.1, -t * 0.68, 0.22) * 0.24;

		float horizonGate = smoothstep(0.08, 0.19, elevation);
		float zenithGate = 1.0 - smoothstep(0.90, 0.99, elevation);
		float visibility = horizonGate * zenithGate * uNightFactor;
		float energy = clamp(primary + secondary, 0.0, 1.35) * visibility;
		float slowBreathing = 0.90 + 0.10 * sin(t * 0.13 + ray4Fbm(vec2(shearedAz * 0.7, 2.7)) * 6.28318530718);
		energy *= slowBreathing;
		float haze = pow(clamp(primary * 0.65 + secondary * 0.35, 0.0, 1.0), 0.72) * visibility;

		vec3 oxygenGreen = mix(uAuroraColorA, vec3(0.18, 0.95, 0.56), 0.67);
		vec3 cyanGreen = vec3(0.15, 0.76, 0.63);
		vec3 subduedViolet = mix(uAuroraColorB, vec3(0.42, 0.28, 0.60), 0.70);
		float cyanVariation = ray4Noise(vec2(shearedAz * 3.4 + t * 0.005, elevation * 1.7));
		vec3 auroraColor = mix(oxygenGreen, cyanGreen, 0.12 + cyanVariation * 0.20);
		float violetFringe = smoothstep(0.64, 0.88, elevation) * smoothstep(0.42, 0.92, ray4Fbm(vec2(shearedAz * 1.8, t * 0.004 + 8.0))) * 0.15;
		auroraColor = mix(auroraColor, subduedViolet, violetFringe);

		vec3 finalColor = skyColor;
		finalColor += oxygenGreen * haze * 0.10;
		finalColor += auroraColor * energy * 0.82;
		gl_FragColor = vec4(finalColor, 1.0);
	}
`;

export function applyAuroraRayCurtainV4(material) {
	material.fragmentShader = AURORA_RAY_CURTAIN_V4_FRAGMENT_SHADER;
	material.needsUpdate = true;
	material.userData.realisticAurora = true;
	material.userData.naturalAuroraCurtains = true;
	material.userData.auroraCurtainRaysV4 = true;
	return material;
}
