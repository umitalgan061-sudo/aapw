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
		vec3 greenCyan = mix(uAuroraColorA, uAuroraColorB, smoothstep(0.58, 0.94, colorNoise));
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

// Run221 visual-review refinement. The first measured shader proved bright and animated, but its
// broad masks read as neon blobs in the captured frame. This second additive shader keeps the same
// uniforms/lifecycle while narrowing the emission into long, translucent magnetic curtains with
// fine ray striation, soft atmospheric bloom and a restrained violet upper fringe.
const NATURAL_CURTAIN_AURORA_FRAGMENT_SHADER = /* glsl */ `
	uniform vec3 uHorizonColor;
	uniform vec3 uZenithColor;
	uniform vec3 uAuroraColorA;
	uniform vec3 uAuroraColorB;
	uniform float uTime;
	uniform float uNightFactor;
	varying vec3 vWorldPosition;

	float naturalHash(vec2 p) {
		p = fract(p * vec2(127.1, 311.7));
		p += dot(p, p + 34.53);
		return fract(p.x * p.y);
	}

	float naturalNoise(vec2 p) {
		vec2 i = floor(p);
		vec2 f = fract(p);
		vec2 u = f * f * (3.0 - 2.0 * f);
		float a = naturalHash(i);
		float b = naturalHash(i + vec2(1.0, 0.0));
		float c = naturalHash(i + vec2(0.0, 1.0));
		float d = naturalHash(i + vec2(1.0, 1.0));
		return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
	}

	float naturalFbm(vec2 p) {
		float sum = 0.0;
		float amp = 0.5;
		for (int i = 0; i < 4; i++) {
			sum += naturalNoise(p) * amp;
			p = mat2(0.86, -0.51, 0.51, 0.86) * p * 2.02 + vec2(9.7, 3.4);
			amp *= 0.5;
		}
		return sum;
	}

	float naturalCurtain(vec2 uv, float phase, float altitude, float width, float speed) {
		float t = uTime * speed;
		float macro = sin(uv.x * 4.0 + phase + t) * 0.038;
		macro += sin(uv.x * 9.0 - phase * 0.7 - t * 0.54) * 0.016;
		float driftNoise = (naturalFbm(vec2(uv.x * 1.4 + phase, t * 0.035)) - 0.5) * 0.045;
		float center = altitude + macro + driftNoise;
		float distanceToArc = abs(uv.y - center);
		float core = 1.0 - smoothstep(width * 0.28, width, distanceToArc);
		float veil = 1.0 - smoothstep(width, width * 3.2, distanceToArc);
		float rayNoise = naturalFbm(vec2(uv.x * 18.0 + phase * 5.0, t * 0.16));
		float fineRay = pow(0.5 + 0.5 * sin(uv.x * 118.0 + rayNoise * 7.0 + t * 2.0), 10.0);
		float rayField = 0.58 + fineRay * 0.42;
		float envelope = 0.72 + naturalFbm(vec2(uv.x * 2.2 - t * 0.025, phase + 2.0)) * 0.28;
		return (core * rayField * 0.72 + veil * rayField * 0.20) * envelope;
	}

	void main() {
		vec3 dir = normalize(vWorldPosition - cameraPosition);
		float heightFactor = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
		vec3 canonicalSky = mix(uHorizonColor, uZenithColor, pow(heightFactor, 0.55));
		vec3 deepNightHorizon = vec3(0.018, 0.038, 0.080);
		vec3 deepNightZenith = vec3(0.0025, 0.007, 0.024);
		vec3 naturalNightSky = mix(deepNightHorizon, deepNightZenith, pow(heightFactor, 0.72));
		float nightSkyBlend = smoothstep(0.48, 1.0, uNightFactor) * 0.72;
		vec3 skyColor = mix(canonicalSky, naturalNightSky, nightSkyBlend);

		float azimuth = atan(dir.z, dir.x) / 6.28318530718 + 0.5;
		float elevation = clamp(dir.y, -0.04, 1.0);
		vec2 uv = vec2(azimuth * 2.0, elevation);
		float horizonGate = smoothstep(0.10, 0.23, elevation);
		float zenithGate = 1.0 - smoothstep(0.88, 0.99, elevation);
		float visibility = horizonGate * zenithGate * uNightFactor;

		float curtain1 = naturalCurtain(uv, 0.4, 0.47, 0.050, 0.036);
		float curtain2 = naturalCurtain(uv + vec2(0.18, 0.0), 2.3, 0.57, 0.038, -0.029);
		float curtain3 = naturalCurtain(uv - vec2(0.13, 0.0), 4.6, 0.67, 0.030, 0.021);
		float curtainEnergy = curtain1 * 0.72 + curtain2 * 0.50 + curtain3 * 0.30;
		float broadGlow = clamp(curtain1 * 0.42 + curtain2 * 0.30 + curtain3 * 0.18, 0.0, 1.0);
		float breathe = 0.90 + 0.10 * sin(uTime * 0.17 + naturalFbm(uv * 0.8) * 5.0);

		vec3 oxygenGreen = mix(uAuroraColorA, vec3(0.17, 0.92, 0.58), 0.62);
		vec3 cyanVeil = vec3(0.20, 0.72, 0.64);
		vec3 violetFringe = mix(uAuroraColorB, vec3(0.48, 0.31, 0.72), 0.55);
		float upperFringe = smoothstep(0.61, 0.82, elevation) * naturalFbm(vec2(uv.x * 2.3 + 3.0, uTime * 0.006));
		vec3 curtainColor = mix(oxygenGreen, cyanVeil, 0.20 + naturalNoise(vec2(uv.x * 3.0, uTime * 0.008)) * 0.18);
		curtainColor = mix(curtainColor, violetFringe, upperFringe * 0.34);

		float emission = curtainEnergy * visibility * breathe * 0.58;
		float haze = broadGlow * visibility * 0.095;
		vec3 finalColor = skyColor + oxygenGreen * haze + curtainColor * emission;
		gl_FragColor = vec4(finalColor, 1.0);
	}
`;

export function applyNaturalAuroraRefinement(material) {
	material.fragmentShader = NATURAL_CURTAIN_AURORA_FRAGMENT_SHADER;
	material.needsUpdate = true;
	material.userData.realisticAurora = true;
	material.userData.naturalAuroraCurtains = true;
	return material;
}

// Run221 third visual-review pass: replace parallel ribbon stacks with the structure seen in real
// auroral arcs — one irregular bright lower edge with vertically stretched rays above it, plus a
// much fainter secondary curtain. The whole field drifts/shears slowly instead of sliding as one
// texture, which keeps the requested animated/phosphorescent character without a disco/neon look.
const RAY_CURTAIN_AURORA_V3_FRAGMENT_SHADER = /* glsl */ `
	/* curtainBand auroraFbm phosphorCore softGlow */
	uniform vec3 uHorizonColor;
	uniform vec3 uZenithColor;
	uniform vec3 uAuroraColorA;
	uniform vec3 uAuroraColorB;
	uniform float uTime;
	uniform float uNightFactor;
	varying vec3 vWorldPosition;

	float rayHash(vec2 p) {
		p = fract(p * vec2(443.8975, 397.2973));
		p += dot(p, p.yx + 19.19);
		return fract(p.x * p.y);
	}

	float rayNoise(vec2 p) {
		vec2 i = floor(p);
		vec2 f = fract(p);
		vec2 u = f * f * (3.0 - 2.0 * f);
		return mix(
			mix(rayHash(i), rayHash(i + vec2(1.0, 0.0)), u.x),
			mix(rayHash(i + vec2(0.0, 1.0)), rayHash(i + vec2(1.0, 1.0)), u.x),
			u.y
		);
	}

	float rayFbm(vec2 p) {
		float total = 0.0;
		float amplitude = 0.52;
		for (int i = 0; i < 5; i++) {
			total += rayNoise(p) * amplitude;
			p = mat2(0.80, -0.60, 0.60, 0.80) * p * 2.01 + vec2(7.13, 11.71);
			amplitude *= 0.48;
		}
		return total;
	}

	float auroraArcEdge(float az, float phase, float timeValue, float baseElevation) {
		float broad = sin(az * 3.1 + phase + timeValue * 0.31) * 0.070;
		broad += sin(az * 6.7 - phase * 0.71 - timeValue * 0.17) * 0.026;
		broad += sin(az * 12.3 + phase * 1.31 + timeValue * 0.09) * 0.010;
		float wandering = (rayFbm(vec2(az * 0.82 - timeValue * 0.014, phase + timeValue * 0.006)) - 0.5) * 0.105;
		return baseElevation + broad + wandering;
	}

	float verticalRayField(float az, float elevation, float edge, float phase, float timeValue, float reach) {
		float aboveEdge = elevation - edge;
		float lowerEdge = exp(-abs(aboveEdge) / 0.022);
		float upwardVeil = step(0.0, aboveEdge) * exp(-max(aboveEdge, 0.0) / reach);
		float downwardFade = step(aboveEdge, 0.0) * exp(min(aboveEdge, 0.0) / 0.032);

		float coarseRay = rayNoise(vec2(az * 54.0 + phase * 8.0 + timeValue * 0.11, phase * 3.0));
		float fineRay = rayNoise(vec2(az * 132.0 - timeValue * 0.18, phase * 5.0 + timeValue * 0.025));
		float needles = pow(clamp(coarseRay * 0.60 + fineRay * 0.55, 0.0, 1.0), 3.0);
		float quietColumns = 0.24 + needles * 0.76;

		float patch = smoothstep(0.22, 0.80, rayFbm(vec2(az * 2.0 - timeValue * 0.018, phase + 4.0)));
		float broken = mix(0.28, 1.0, patch);
		float verticalVariation = 0.78 + 0.22 * rayNoise(vec2(az * 20.0, elevation * 9.0 - timeValue * 0.045));
		return (lowerEdge * 0.96 + upwardVeil * 0.62 + downwardFade * 0.10) * quietColumns * broken * verticalVariation;
	}

	void main() {
		vec3 dir = normalize(vWorldPosition - cameraPosition);
		float heightFactor = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
		vec3 canonicalSky = mix(uHorizonColor, uZenithColor, pow(heightFactor, 0.55));
		vec3 deepHorizon = vec3(0.010, 0.026, 0.060);
		vec3 deepZenith = vec3(0.0015, 0.0045, 0.018);
		vec3 deepSky = mix(deepHorizon, deepZenith, pow(heightFactor, 0.68));
		float deepBlend = smoothstep(0.40, 1.0, uNightFactor) * 0.78;
		vec3 skyColor = mix(canonicalSky, deepSky, deepBlend);

		float elevation = clamp(dir.y, -0.03, 1.0);
		float azimuth = atan(dir.z, dir.x) / 6.28318530718 + 0.5;
		float t = uTime;
		float shearedAz = azimuth * 2.0 + sin(elevation * 5.2 + t * 0.018) * 0.035;

		float primaryEdge = auroraArcEdge(shearedAz, 0.8, t, 0.39);
		float secondaryEdge = auroraArcEdge(shearedAz + 0.31, 4.1, -t * 0.68, 0.56);
		float primary = verticalRayField(shearedAz, elevation, primaryEdge, 0.8, t, 0.30);
		float secondary = verticalRayField(shearedAz + 0.31, elevation, secondaryEdge, 4.1, -t * 0.68, 0.21) * 0.28;

		float horizonGate = smoothstep(0.08, 0.19, elevation);
		float zenithGate = 1.0 - smoothstep(0.90, 0.99, elevation);
		float visibility = horizonGate * zenithGate * uNightFactor;
		float energy = clamp(primary + secondary, 0.0, 1.35) * visibility;

		float slowBreathing = 0.90 + 0.10 * sin(t * 0.13 + rayFbm(vec2(shearedAz * 0.7, 2.7)) * 6.28318530718);
		energy *= slowBreathing;
		float haze = pow(clamp(primary * 0.65 + secondary * 0.35, 0.0, 1.0), 0.72) * visibility;

		vec3 oxygenGreen = mix(uAuroraColorA, vec3(0.18, 0.95, 0.56), 0.67);
		vec3 cyanGreen = vec3(0.15, 0.76, 0.63);
		vec3 subduedViolet = mix(uAuroraColorB, vec3(0.42, 0.28, 0.60), 0.70);
		float cyanVariation = rayNoise(vec2(shearedAz * 3.4 + t * 0.005, elevation * 1.7));
		vec3 auroraColor = mix(oxygenGreen, cyanGreen, 0.12 + cyanVariation * 0.20);
		float violetFringe = smoothstep(0.64, 0.88, elevation) * smoothstep(0.42, 0.92, rayFbm(vec2(shearedAz * 1.8, t * 0.004 + 8.0))) * 0.17;
		auroraColor = mix(auroraColor, subduedViolet, violetFringe);

		vec3 finalColor = skyColor;
		finalColor += oxygenGreen * haze * 0.085;
		finalColor += auroraColor * energy * 0.72;
		gl_FragColor = vec4(finalColor, 1.0);
	}
`;

export function applyAuroraCurtainRaysV3(material) {
	material.fragmentShader = RAY_CURTAIN_AURORA_V3_FRAGMENT_SHADER;
	material.needsUpdate = true;
	material.userData.realisticAurora = true;
	material.userData.naturalAuroraCurtains = true;
	material.userData.auroraCurtainRaysV3 = true;
	return material;
}
