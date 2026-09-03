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
	/**
	 * Grazing-angle response (run 427, corrected run 430). Schlick's approximation uses an exponent of
	 * 5; 4 here, because this stands in for a whole environment reflection rather than just the Fresnel
	 * factor, and 5 kept the effect too close to the silhouette to read at the distances the defect
	 * shows up at. Applied to the *lit* colour, not the albedo — see `applyNaturalRiverEdge`.
	 */
	glanceExponent: 4,
	/** How far toward the sky's own horizon colour the water goes when seen edge-on. */
	glanceSkyStrength: 0.85,
	/** ...and how much of its transparency it gives up there. Reflected sky hides the bed. */
	glanceOpacityStrength: 0.7,
	/**
	 * Run 428. The ribbon material is `DoubleSide`, and three.js flips the shading normal on back faces
	 * so they light as if they faced you. For an opaque solid that is right; for a water sheet it is
	 * not, and it is what actually drew the black band (see `applyNaturalRiverEdge` for the
	 * measurement). With this on, the shading normal's vertical component is forced upward, so both
	 * faces of the sheet take their light from the sky.
	 */
	skyLitFromBothSides: true,
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
			)
			// Run 428: the shading normal. Anchored after the normal maps so `normal` is the finished one.
			.replace(
				'#include <normal_fragment_maps>',
				`#include <normal_fragment_maps>
{
	// Run 428, and this is the half that mattered. The ribbon is DoubleSide, and three.js flips the
	// shading normal on a back face so it points at the viewer. Look up at a river from lower ground --
	// which happens constantly, because the ribbon spans a carved channel as a flat chord and its own
	// banks sit 0.3 m proud of the terrain -- and you are shading a surface whose normal now points
	// DOWN, away from the sun. Diffuse irradiance goes to zero and the water renders as an unlit black
	// plate. Raycasts through the band at the berk viewpoint returned river-mander every time with
	// world normals of (0.25,-0.95,-0.20), (0.29,-0.96,-0.03) and (0.11,-0.99,-0.01): all three
	// pointing at the ground.
	//
	// This is also why run 427's glance term alone did not fix it. That term lightens diffuseColor, and
	// diffuseColor is then multiplied by an irradiance of nearly nothing -- a brighter albedo times no
	// light is still black. The normal has to be corrected first.
	//
	// A sheet of water has no side that faces away from the sky: from underneath you see the same
	// surface lit by the same sky, which is why looking up through water is bright rather than dark.
	// Forcing the vertical component upward keeps every horizontal wobble the flow patch and the normal
	// map put there, and only ever changes back faces -- on a front face normal.y is already positive
	// and this is a no-op.
	normal.y = abs(normal.y);
}`,
			)
			// Run 430: the sky reflection, and *where* it happens is the whole point. See the comment.
			.replace(
				'#include <fog_fragment>',
				`{
	// Water seen edge-on is a mirror of the sky, and it gets lighter, not darker. This material has no
	// environment to reflect, so at a grazing angle its specular term returns nothing and all that is
	// left is a dark blue albedo. Run 427 added this term. Run 430 had to move it twice, and both
	// wrong placements are worth keeping written down because each one looked right.
	//
	// **First it mixed the sky into diffuseColor** -- the albedo -- and the lighting then multiplied
	// that albedo by the full sun and ambient irradiance. The water was not showing you the sky, it was
	// painted sky-coloured and then lit, which is a different and much brighter thing.
	//
	// **Then it mixed into gl_FragColor at opaque_fragment,** which is after the lighting but *before*
	// tonemapping and the sRGB encode. fogColor is not a linear value: three.js applies its own fog at
	// <fog_fragment>, downstream of <colorspace_fragment>, so fogColor lives in output space. Dropping
	// it in upstream meant the encode ran over it a second time. Measured on the ziya viewpoint: the
	// river came out at RGB (186,201,206) against a horizon sky of (31,66,118) -- and a roughness sweep
	// plus a sun switched off entirely moved it by less than one count, which is what proved the colour
	// was not lit at all but pasted in.
	//
	// Here, at <fog_fragment>, gl_FragColor is in exactly the space fogColor is quoted in, so the mix
	// is a reflection rather than a repaint and the water can approach the sky's brightness without
	// passing it. three.js's own distance fog runs immediately after and still gets the last word.
	//
	// fogColor is the sky's own horizon colour, updated every frame by fog.js from the day/night state,
	// so the water follows exactly what the atmosphere behind it is doing rather than a second colour
	// that would drift away from it. Guarded on USE_FOG: nothing in this project turns scene fog off,
	// but a shader that fails to compile if someone does is a trap.
	#ifdef USE_FOG
		float riverFacing = abs(dot(normalize(vViewPosition), normal));
		float riverGlance = pow(1.0 - riverFacing, ${P.glanceExponent.toFixed(1)});
		gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, riverGlance * ${P.glanceSkyStrength.toFixed(2)});
		// ...and it stops being see-through at the same time, for the same reason: what you are looking
		// at is reflected sky, and reflected sky hides the bed.
		gl_FragColor.a = mix(gl_FragColor.a, 1.0, riverGlance * ${P.glanceOpacityStrength.toFixed(2)});
	#endif
}
#include <fog_fragment>`,
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
