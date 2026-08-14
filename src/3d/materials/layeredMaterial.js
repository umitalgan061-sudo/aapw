/**
 * Layered vertical-band material — dressing a figure whose parts cannot be identified by name.
 *
 * Most character models in this project arrive as a single mesh with a single unnamed material
 * (`peasant-girl` is exactly that), so `meshPartClassifier.js` has nothing to work with. Painting
 * such a figure one flat colour is the very flaw this system exists to fix, so instead the figure is
 * dressed *by height*: boots at the bottom, then trousers, belt, tunic, skin, hair.
 *
 * Implementation is a single `MeshStandardMaterial` whose fragment shader picks between up to six
 * band textures using the mesh's own object-space Y, normalized over its bounding box. That keeps it
 * to one draw call and one material — important because these figures are placed in crowds — while
 * still producing a properly clothed character.
 *
 * Object space, not world space: a figure must stay correctly dressed after it is moved, rotated or
 * scaled in the editor, which world-space banding would break.
 * @module materials/layeredMaterial
 */

import * as THREE from 'three';
import { getPaletteTexture } from './textureFactory.js';

/** Maximum bands the shader supports. Six covers boot/trousers/belt/tunic/skin/hair, which is the
 * deepest kit in `figureKits.js`; more would cost uniform slots for no modelled benefit. */
export const MAX_BANDS = 6;

/** Softness of the transition between neighbouring bands, in normalized height. A hard cut reads as
 * a printed stripe; this much blur reads as a hem. */
const BAND_BLEND = 0.012;

/**
 * Builds a layered material for one mesh.
 *
 * @param {object} options
 * @param {{to: number, palette: string}[]} options.bands Bottom-to-top bands; `to` is the normalized
 *   height where the band ends.
 * @param {{min: number, max: number}} options.heightRange Object-space Y extent of the target mesh.
 * @param {string} [options.variant] Seed material so two figures differ.
 * @param {number} [options.size] Texture size per band.
 * @returns {THREE.MeshStandardMaterial|null}
 */
export function createLayeredMaterial({ bands, heightRange, variant = '', size = 128 }) {
	const usable = (bands || []).slice(0, MAX_BANDS).filter((band) => band && band.palette);
	if (usable.length === 0) return null;
	if (usable.length === 1) return null; // A single band is just a normal material — let the caller use one.

	const textures = [];
	for (const band of usable) {
		const texture = getPaletteTexture(band.palette, { size, variant });
		if (!texture) return null;
		textures.push(texture);
	}

	const span = Math.max(1e-4, heightRange.max - heightRange.min);
	const material = new THREE.MeshStandardMaterial({
		map: textures[0],
		color: 0xffffff,
		roughness: 0.82,
		metalness: 0.04,
	});

	const uniforms = {
		uBandCount: { value: usable.length },
		uBandEdges: { value: padded(usable.map((band) => band.to)) },
		uMinY: { value: heightRange.min },
		uInvSpanY: { value: 1 / span },
		uBandBlend: { value: BAND_BLEND },
	};
	textures.forEach((texture, index) => {
		uniforms[`uBandMap${index}`] = { value: texture };
	});

	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);

		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying float vLayeredHeight;')
			.replace(
				'#include <begin_vertex>',
				'#include <begin_vertex>\nvLayeredHeight = position.y;',
			);

		const samplers = Array.from({ length: usable.length }, (_, index) => `uniform sampler2D uBandMap${index};`).join('\n');
		// A loop cannot index samplers in GLSL ES 1.0, so the band choice is an unrolled chain of
		// mixes — six branches at most, and each one is a smoothstep so hems blend instead of cutting.
		const picks = usable.map((_, index) => (index === 0
			? `vec4 layered = texture2D(uBandMap0, vMapUv);`
			: `layered = mix(layered, texture2D(uBandMap${index}, vMapUv), smoothstep(uBandEdges[${index - 1}] - uBandBlend, uBandEdges[${index - 1}] + uBandBlend, h));`)).join('\n\t');

		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>\nvarying float vLayeredHeight;\nuniform int uBandCount;\nuniform float uBandEdges[${MAX_BANDS}];\nuniform float uMinY;\nuniform float uInvSpanY;\nuniform float uBandBlend;\n${samplers}`,
			)
			.replace(
				'#include <map_fragment>',
				`{
	float h = clamp((vLayeredHeight - uMinY) * uInvSpanY, 0.0, 1.0);
	${picks}
	diffuseColor *= layered;
}`,
			);
	};

	// Distinct cache key per band recipe, otherwise THREE reuses one compiled program for materials
	// whose unrolled shader source actually differs.
	const key = `layered:${usable.map((band) => band.palette).join('|')}`;
	material.customProgramCacheKey = () => key;
	material.userData.generatedByTextureFactory = true;
	material.userData.layeredBands = usable.map((band) => band.palette);
	material.name = key;
	material.needsUpdate = true;
	return material;
}

/**
 * Pads a band-edge list to `MAX_BANDS` so the uniform array always has a fixed length.
 * @param {number[]} edges
 * @returns {number[]}
 */
function padded(edges) {
	const out = edges.slice(0, MAX_BANDS);
	while (out.length < MAX_BANDS) out.push(1);
	return out;
}

/**
 * Object-space vertical extent of a mesh's geometry — the range the bands are mapped over.
 * @param {import('three').Mesh} mesh
 * @returns {{min: number, max: number}|null}
 */
export function meshHeightRange(mesh) {
	const geometry = mesh?.geometry;
	if (!geometry) return null;
	if (!geometry.boundingBox) geometry.computeBoundingBox();
	const box = geometry.boundingBox;
	if (!box || !Number.isFinite(box.min.y) || !Number.isFinite(box.max.y)) return null;
	return { min: box.min.y, max: box.max.y };
}
