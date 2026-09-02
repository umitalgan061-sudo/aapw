/**
 * Banks, not edges: what turns a river ribbon from a painted stripe into water in a channel.
 *
 * **The defect.** A survey render (`artifacts/world-survey/seat-ziya.png`) showed a river as a bright
 * band of constant width with hard parallel edges lying across open ground. Every part of that reads
 * as a decal: real water has no straight edge, and it does not end at full depth — it thins into
 * shallows over its own bed before it stops.
 *
 * **What this fixes and what it deliberately does not.** This is the *appearance* half. The other half
 * is geography, and it is measured, understood and not addressed here: `scripts/` evidence taken this
 * run shows the valley carving working (cutting 8-29 m along the Green Fork) while the traced course
 * still runs along the upper part of a slope, so ground 15-90 m to one side sits below the water line.
 * That is a routing problem in `generateRiverPath`, it moves river courses, and moving river courses
 * moves bridges, road crossings and half a dozen gates with them. It is written up in
 * `3D_GAME_PROGRESS.md` as its own subtask rather than smuggled in behind a shader.
 *
 * **The technique is the roads'.** Run 406 gave the road ribbon a frayed boundary by discarding
 * fragments past a noise-modulated half-width, in world space so the fray follows the ground rather
 * than the mesh. The same applies here, plus a shallow-water band the roads have no equivalent of:
 * toward the bank the water lightens and thins, because you are seeing less depth of it.
 *
 * Render-only. No vertex moves, no attribute is added — `aFlowSide` already carries -1 on the left
 * edge and +1 on the right, put there by `rivers.js`'s flow animation — and the ribbon's own width,
 * course and grounding are untouched, so everything calibrated against them still holds.
 *
 * @module world/riverEdgeAppearance
 */

export const RIVER_EDGE_POLICY = Object.freeze({
	id: 'river-natural-edge-v1',
	/**
	 * Fraction of the ribbon's half-width that always survives, before noise. The three terms below
	 * average to about 0.85, so the drawn river is on average a little narrower than the ribbon and
	 * never wider than it — the geometry stays the outer bound, exactly as it does for roads.
	 */
	minimumKeptHalfWidth: 0.72,
	/** Metres-per-cycle of the broad wander in the bank line, and of the fine chop on top of it. */
	bankWanderScale: 0.055,
	bankDetailScale: 0.28,
	/** Fraction of the half-width, measured in from the bank, that reads as shallows. */
	shallowBandFraction: 0.62,
	renderOnly: true,
});

/**
 * Chains a bank pass onto a river ribbon's material.
 *
 * Anchored on `#include <roughnessmap_fragment>` rather than on `<color_fragment>`, which
 * `rivers.js`'s flow animation has already claimed: that chunk runs after the colour is composed and
 * before any lighting, so the shallows tint the finished water rather than the bare vertex colour, and
 * the two patches cannot fight over the same anchor.
 *
 * @param {import('three').MeshStandardMaterial} material The ribbon material, mutated in place.
 * @returns {import('three').MeshStandardMaterial} the same material.
 */
export function applyNaturalRiverEdge(material) {
	const P = RIVER_EDGE_POLICY;
	const previousOnBeforeCompile = material.onBeforeCompile?.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		if (previousOnBeforeCompile) previousOnBeforeCompile(shader, renderer);
		shader.vertexShader = `varying vec2 vRiverBankXZ;\n${shader.vertexShader}`.replace(
			'#include <begin_vertex>',
			`#include <begin_vertex>
	vRiverBankXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`,
		);
		shader.fragmentShader = `varying vec2 vRiverBankXZ;
float riverBankHash(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.3))) * 24634.6345); }
float riverBankNoise(vec2 p) {
	vec2 cell = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = riverBankHash(cell);
	float b = riverBankHash(cell + vec2(1.0, 0.0));
	float c = riverBankHash(cell + vec2(0.0, 1.0));
	float d = riverBankHash(cell + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
${shader.fragmentShader}`.replace(
			'#include <roughnessmap_fragment>',
			`#include <roughnessmap_fragment>
{
	float riverAcross = abs(vFlowSide);
	// The bank is cut in world space, so it wanders with the ground rather than with the ribbon's own
	// vertices -- two reaches that happen to run parallel do not meander in step.
	float riverWander = riverBankNoise(vRiverBankXZ * ${P.bankWanderScale.toFixed(4)});
	float riverChop = riverBankNoise(vRiverBankXZ * ${P.bankDetailScale.toFixed(4)});
	float riverKept = ${P.minimumKeptHalfWidth.toFixed(3)} + riverWander * 0.22 + (riverChop - 0.5) * 0.12;
	if (riverAcross > riverKept) discard;
	// Shallows. Toward the bank there is simply less water above the bed, so it lightens, loses its
	// blue, and stops hiding what is underneath -- which is the cue that reads as depth, and the one
	// a constant-alpha ribbon has never had.
	float riverShallow = smoothstep(riverKept * ${P.shallowBandFraction.toFixed(3)}, riverKept, riverAcross);
	diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.42, 1.30, 1.10) + vec3(0.05, 0.06, 0.04), riverShallow * 0.8);
	diffuseColor.a *= 1.0 - riverShallow * 0.62;
	// Water is glassy midstream and rougher where it drags over the shallows.
	roughnessFactor = mix(roughnessFactor, 0.55, riverShallow * 0.7);
}`,
		);
	};
	material.userData.riverNaturalEdge = Object.freeze({
		policyId: P.id,
		minimumKeptHalfWidth: P.minimumKeptHalfWidth,
		extraDrawCalls: 0,
		renderOnly: true,
	});
	material.needsUpdate = true;
	return material;
}
