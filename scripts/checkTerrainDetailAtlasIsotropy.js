#!/usr/bin/env node
/**
 * checkTerrainDetailAtlasIsotropy.js — guards run 368 / ADR-0315's terrain detail atlas.
 *
 * **The defect this exists to prevent.** `world/terrainMicroSurface.js` builds a small tileable atlas
 * that supplies the terrain's normal and roughness detail, repeated every 22 m across the whole world.
 * Its height field used to be a sum of six sinusoids at integer frequencies — `3u+5v`, `7u-4v`,
 * `11u+13v`, `19u-17v`, `29u+23v`, `37u-31v`. Integer frequencies make an atlas exactly tileable, which
 * is why it was written that way, but every one of those terms is a plane wave along a fixed diagonal.
 * Summed and tiled every 22 m, they did not read as surface grain: they read as a diagonal cross-hatch
 * weave over every hillside in the world.
 *
 * That artefact cost two wrong diagnoses before it was isolated. It follows the mesh triangulation and
 * is strongest where triangles are large, so it looked like height-noise aliasing; an LOD-aware band
 * limit was built for the height sampler, measured to change far-field heights by a mean of 1.17 m, and
 * changed the render not at all. It was only pinned down by re-rendering the same view with the detail
 * map detached, which removed it entirely. So this check tests the two properties that actually matter,
 * because "looks fine" clearly did not catch it:
 *
 * **1. Exact tileability.** The atlas repeats every 22 m; a discontinuity at its seam would draw a hard
 * grid line every 22 m across the world. Measured as the gradient across the wrap seam against the
 * distribution of interior gradients — a seam must not stand out from ordinary detail.
 *
 * **2. Directional isotropy.** This is the real regression guard. Surface grain must have no preferred
 * direction. Measured as mean squared directional derivative over 12 evenly spaced directions; a plane
 * wave concentrates nearly all its energy along its own travel direction and almost none across it, so
 * the ratio between the strongest and weakest direction separates grain from weave decisively.
 *
 * **The old function is embedded below as a negative control**, and the check asserts it *fails* the
 * same bar the current one passes. Without that, an isotropy threshold could silently be loose enough
 * to pass anything — the recurring failure in this project has been checks that score what the code
 * does not do.
 *
 * Usage: `node scripts/checkTerrainDetailAtlasIsotropy.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkTerrainDetailAtlasIsotropy
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/**
 * Strongest:weakest directional energy a field may have and still count as grain rather than weave.
 *
 * **Calibrated from the two measured populations, not guessed.** The shipped value-noise atlas scores
 * 1.13x on this instrument; the plane-wave field it replaced scores 2.01x. 1.5 sits between them, so
 * the check discriminates the actual defect it was written for — which the embedded control below
 * asserts on every run, because a first attempt at this used a ceiling of 3x that both fields passed.
 */
const MAX_ANISOTROPY_RATIO = 1.5;
/** Isotropy is scored on the field's own variance, so this ratio is amplitude-independent. */
const ISOTROPY_LAG_PIXELS = 8;

(async () => {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[detail-atlas] SKIP: Playwright unavailable');
		process.exit(2);
	}
	const server = await startStaticServer();
	const origin = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${origin}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		const result = await page.evaluate(async ({ directions }) => {
			const micro = await import('/src/3d/world/terrainMicroSurface.js');
			const P = micro.TERRAIN_MICRO_SURFACE_POLICY;
			const size = P.textureSize;
			const repeat = P.detailRepeatMeters;

			// The real field, not a reconstruction. An earlier revision of this check scored the built
			// normal map instead; its rectified gradient magnitude destroyed the very directionality the
			// check exists to detect, and the embedded control duly reported the instrument was blind.
			const field = new Float64Array(size * size);
			for (let y = 0; y < size; y += 1) {
				for (let x = 0; x < size; x += 1) field[y * size + x] = micro.terrainDetailHeight(x / size, y / size);
			}

			const at = (f, x, y) => f[(((y % size) + size) % size) * size + (((x % size) + size) % size)];

			// Directional energy: mean squared difference at a fixed lag along each of N directions,
			// normalised by the field's own variance so fields of different amplitude are comparable.
			//
			// The lag matters. At a 2 px lag the integer-rounded offsets collapse a dozen directions onto a
			// handful of identical vectors, which is why an earlier revision could not tell a plane-wave
			// weave from isotropic grain at all. 8 px keeps the directions distinct and sits near a quarter
			// wavelength of the coarsest structure, where a travelling wave is most anisotropic.
			const LAG = 8;
			const directionalEnergy = (f) => {
				let mean = 0;
				for (let i = 0; i < f.length; i += 1) mean += f[i];
				mean /= f.length;
				let variance = 0;
				for (let i = 0; i < f.length; i += 1) variance += (f[i] - mean) * (f[i] - mean);
				variance = variance / f.length || 1;
				const out = [];
				for (let d = 0; d < directions; d += 1) {
					const angle = (Math.PI * d) / directions;
					const sx = Math.round(Math.cos(angle) * LAG);
					const sy = Math.round(Math.sin(angle) * LAG);
					let sum = 0;
					let n = 0;
					for (let y = 0; y < size; y += 1) {
						for (let x = 0; x < size; x += 1) {
							const delta = at(f, x + sx, y + sy) - at(f, x, y);
							sum += delta * delta;
							n += 1;
						}
					}
					out.push(sum / n / variance);
				}
				return out;
			};

			// Seam continuity: gradient across the wrap edge vs the interior gradient distribution.
			const interior = [];
			for (let y = 0; y < size; y += 1) {
				for (let x = 1; x < size - 1; x += 1) interior.push(Math.abs(at(field, x + 1, y) - at(field, x, y)));
			}
			interior.sort((a, b) => a - b);
			// Worst step across the wrap seam, compared below against the worst step anywhere inside the
			// atlas: a seam that is no sharper than ordinary interior detail cannot draw a visible line.
			let seam = 0;
			for (let y = 0; y < size; y += 1) {
				seam = Math.max(seam, Math.abs(at(field, 0, y) - at(field, size - 1, y)));
				seam = Math.max(seam, Math.abs(at(field, y, 0) - at(field, y, size - 1)));
			}

			// Negative control: the plane-wave field this replaced, scored by the same instrument.
			const TAU = Math.PI * 2;
			const legacy = new Float64Array(size * size);
			for (let y = 0; y < size; y += 1) {
				for (let x = 0; x < size; x += 1) {
					const u = x / size;
					const v = y / size;
					legacy[y * size + x] = 0.34 * Math.sin(TAU * (3 * u + 5 * v) + 0.41)
						+ 0.22 * Math.cos(TAU * (7 * u - 4 * v) + 1.73)
						+ 0.16 * Math.sin(TAU * (11 * u + 13 * v) + 2.19)
						+ 0.11 * Math.cos(TAU * (19 * u - 17 * v) + 0.87)
						+ 0.09 * Math.sin(TAU * (29 * u + 23 * v) + 2.81)
						+ 0.08 * Math.cos(TAU * (37 * u - 31 * v) + 1.21);
				}
			}

			const ratioOf = (energies) => {
				const positive = energies.filter((e) => e > 0);
				return Math.max(...positive) / Math.min(...positive);
			};
			const shippedEnergies = directionalEnergy(field);
			const legacyEnergies = directionalEnergy(legacy);
			return {
				size,
				repeatMeters: repeat,
				shippedRatio: ratioOf(shippedEnergies),
				legacyRatio: ratioOf(legacyEnergies),
				seam,
				interiorP995: interior[Math.floor(0.995 * (interior.length - 1))],
				interiorMax: interior[interior.length - 1],
			};
		}, { directions: 12 });

		if (result.error) {
			console.error(`[detail-atlas] FAIL: ${result.error}`);
			process.exit(1);
		}

		const failures = [];
		if (!(result.shippedRatio < MAX_ANISOTROPY_RATIO)) {
			failures.push(
				`the detail atlas is directional: strongest:weakest directional energy is ` +
				`${result.shippedRatio.toFixed(2)}x (ceiling ${MAX_ANISOTROPY_RATIO}x). Tiled every ` +
				`${result.repeatMeters} m, a directional field renders as a weave over every hillside.`);
		}
		if (!(result.legacyRatio > MAX_ANISOTROPY_RATIO)) {
			failures.push(
				`the isotropy test is vacuous: the plane-wave field it replaced scores ` +
				`${result.legacyRatio.toFixed(2)}x, which would also pass the ${MAX_ANISOTROPY_RATIO}x ceiling`);
		}
		if (!(result.seam <= result.interiorMax)) {
			failures.push(
				`the atlas does not tile cleanly: worst seam step ${result.seam.toFixed(5)} is sharper than the ` +
				`sharpest step anywhere inside the atlas (${result.interiorMax.toFixed(5)}) — a visible grid line ` +
				`every ${result.repeatMeters} m`);
		}

		console.log(`[detail-atlas] atlas ${result.size}x${result.size}, repeating every ${result.repeatMeters} m`);
		console.log(`[detail-atlas] isotropy: shipped ${result.shippedRatio.toFixed(2)}x vs plane-wave control ${result.legacyRatio.toFixed(2)}x (ceiling ${MAX_ANISOTROPY_RATIO}x)`);
		console.log(`[detail-atlas] seam: worst ${result.seam.toFixed(5)} vs interior p99.5 ${result.interiorP995.toFixed(5)} / max ${result.interiorMax.toFixed(5)}`);
		if (failures.length) {
			for (const failure of failures) console.error(`[detail-atlas] FAIL: ${failure}`);
			process.exit(1);
		}
		console.log('[detail-atlas] PASS: grain is isotropic, tiles seamlessly, and the control confirms the test discriminates.');
		process.exit(0);
	} catch (error) {
		console.error('[detail-atlas] FAIL:', error);
		process.exit(1);
	} finally {
		await browser.close();
		server.close();
	}
})();
