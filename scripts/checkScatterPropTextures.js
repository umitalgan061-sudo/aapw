#!/usr/bin/env node
/**
 * No catalogued prop may ask the browser for a texture that is not in the repository (run 399).
 *
 * Once runs 396-398 stopped `checkMobilePerfBudget` timing out, it reached its console-error
 * assertion and CI came back with several hundred 404s for side-car textures — `paddle 1_Normal.png`,
 * `Wooden_Barrel_Base_Color.png`, `TexturesCom_Wall_Cobblestone_3x3_1K_albedo.tif`. None of them exist
 * anywhere under `assets/`. A prop that fetches none of its textures renders in flat untextured
 * colour, so this is a visual defect and not merely a noisy log.
 *
 * **The discriminator is embedded media, not the path string**, and getting that wrong is easy. A
 * naive scan for texture-shaped strings accuses the Mixamo characters, whose paths point at the
 * exporter's own build server (`/home/app/mixamo-mini/tmp/….fbm/`) — but those FBX files carry the
 * image data inside them, three.js reads it out, and no request is ever made. Worse, testing for
 * embedded data on a three-byte JPEG start gives false clears: that byte run occurs by chance inside
 * geometry, and it wrongly cleared `Boat.fbx` — 1.3 MB of file supposedly embedding 36 textures. This
 * uses the full 8-byte PNG signature and 4-byte JPEG markers, which took the count from 27 to 5.
 *
 * **Where it can actually run.** A fresh clone serves Git-LFS pointer stubs, which carry no texture
 * references to inspect, so there the check reports what it could not read instead of passing on an
 * empty measurement. In CI, where `lfs: true` hydrates the objects, it inspects them for real.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IMAGE_REFERENCE = /[\w \-.()\/\\]+?\.(?:png|jpg|jpeg|tga|tif|tiff|bmp|dds)/gi;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURES = [0xe0, 0xe1, 0xdb, 0xee].map((marker) => Buffer.from([0xff, 0xd8, 0xff, marker]));

const isLfsPointer = (buffer) => buffer.length < 400 && buffer.toString('utf8').startsWith('version https://git-lfs');
const carriesImageData = (buffer) => buffer.includes(PNG_SIGNATURE) || JPEG_SIGNATURES.some((s) => buffer.includes(s));

/** Texture basenames the model would fetch, minus those sitting beside it. */
function missingSideCarTextures(buffer, modelDirectory) {
	const wanted = new Set();
	for (const match of buffer.toString('latin1').matchAll(IMAGE_REFERENCE)) {
		const basename = match[0].split(/[\\/]/).pop().trim();
		if (basename && basename.length < 120) wanted.add(basename);
	}
	return [...wanted].filter((name) => !fs.existsSync(path.join(modelDirectory, name)));
}

async function main() {
	const { PROP_CATALOGUE } = await import(`file://${path.join(ROOT, 'src/3d/world/worldPropCatalogue.js')}`);

	const offenders = [];
	let inspected = 0;
	let stubs = 0;
	for (const entry of PROP_CATALOGUE) {
		const file = path.join(ROOT, 'assets/models', entry.file);
		let buffer;
		try {
			buffer = fs.readFileSync(file);
		} catch {
			continue;
		}
		if (isLfsPointer(buffer)) { stubs += 1; continue; }
		inspected += 1;
		if (carriesImageData(buffer)) continue;
		const missing = missingSideCarTextures(buffer, path.dirname(file));
		if (missing.length) offenders.push({ file: entry.file, missing: missing.length, sample: missing.slice(0, 2) });
	}

	if (offenders.length) {
		const listed = offenders
			.sort((a, b) => b.missing - a.missing)
			.map((o) => `${o.file} (${o.missing} missing, e.g. ${o.sample.join(', ')})`)
			.join('; ');
		console.error(
			`[scatter-prop-textures] FAIL: ${offenders.length} catalogued prop(s) reference textures that are not `
				+ `in the repository, so the browser 404s on each and the prop renders untextured: ${listed}. `
				+ 'Either commit the texture set beside the model or withhold it under `texturesNeverCommitted`.',
		);
		process.exit(1);
	}

	if (inspected === 0) {
		// Never report a pass earned by reading nothing.
		console.log(
			`[scatter-prop-textures] SKIP: all ${stubs} catalogued models are Git-LFS pointer stubs in this clone; `
				+ 'nothing to inspect. CI hydrates them and runs this for real.',
		);
		return;
	}
	console.log(
		`[scatter-prop-textures] PASS: ${inspected} catalogued model(s) inspected (${stubs} unhydrated stub(s) skipped); `
			+ 'none fetches a texture that is missing from the repository.',
	);
}

main().catch((error) => {
	console.error(`[scatter-prop-textures] FAIL: ${error.message}`);
	process.exit(1);
});
