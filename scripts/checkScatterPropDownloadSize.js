#!/usr/bin/env node
/**
 * No scatter prop may be enormous to download (run 398).
 *
 * `worldPropExclusions.js` already audited the catalogue by **triangles**, and triangles turned out
 * not to be what was hurting. PR #964's mobile gate timed out in CI while the same boot finished in
 * 8.6s in the dev container, and the difference was never CPU: a fresh clone here serves Git-LFS
 * pointer stubs of 130 bytes where CI serves the real objects. Priced from those pointers, `main`
 * fetched **91.8 MB** before the loading overlay hid and the branch fetched **878.1 MB** — a 520 MB
 * house and a 441 MB fir tree among them, against a catalogue median of 0.92 MB.
 *
 * Geometry budgets cannot see that, because the weight is in texture bytes. This is the missing axis:
 * every catalogued prop is held to `MAX_SCATTER_PROP_BYTES`.
 *
 * It reads each model's **real** size out of its Git-LFS pointer rather than the 130 bytes on disk, so
 * it measures what a player actually downloads and runs in any clone without hydrating an object. A
 * model committed in full (not LFS-backed) is measured directly.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MB = 1024 * 1024;

/** Real download size of a model: the size its LFS pointer records, or the file's own if not a pointer. */
function downloadBytes(relativeToModels) {
	const file = path.join(ROOT, 'assets/models', relativeToModels);
	let buffer;
	try {
		buffer = fs.readFileSync(file);
	} catch {
		return null;
	}
	if (buffer.length < 400) {
		const text = buffer.toString('utf8');
		if (text.startsWith('version https://git-lfs')) {
			const match = text.match(/\bsize (\d+)/);
			return match ? Number(match[1]) : null;
		}
	}
	return buffer.length;
}

async function main() {
	const { PROP_CATALOGUE } = await import(`file://${path.join(ROOT, 'src/3d/world/worldPropCatalogue.js')}`);
	const { MAX_SCATTER_PROP_BYTES } = await import(`file://${path.join(ROOT, 'src/3d/world/worldPropExclusions.js')}`);

	const measured = [];
	const unreadable = [];
	for (const entry of PROP_CATALOGUE) {
		const bytes = downloadBytes(entry.file);
		if (bytes === null) {
			unreadable.push(entry.file);
			continue;
		}
		measured.push({ file: entry.file, terrain: entry.terrain, bytes });
	}

	const over = measured.filter((row) => row.bytes >= MAX_SCATTER_PROP_BYTES).sort((a, b) => b.bytes - a.bytes);
	if (over.length) {
		const listed = over
			.map((row) => `${row.file} (${(row.bytes / MB).toFixed(1)} MB, ${row.terrain})`)
			.join('; ');
		console.error(
			`[scatter-prop-size] FAIL: ${over.length} catalogued prop(s) exceed the `
				+ `${(MAX_SCATTER_PROP_BYTES / MB).toFixed(0)} MB download ceiling: ${listed}. `
				+ 'Either file them under `tooLargeToDownloadForScatter` or commit a decimated derivative.',
		);
		process.exit(1);
	}
	// A catalogue whose models cannot be read at all would pass the ceiling by measuring nothing.
	if (unreadable.length > measured.length) {
		console.error(`[scatter-prop-size] FAIL: ${unreadable.length} catalogued model(s) unreadable — nothing measured.`);
		process.exit(1);
	}

	const total = measured.reduce((sum, row) => sum + row.bytes, 0);
	const sorted = measured.map((row) => row.bytes).sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
	const heaviest = measured.reduce((best, row) => (row.bytes > best.bytes ? row : best), measured[0]);
	console.log(
		`[scatter-prop-size] PASS: ${measured.length} catalogued props, ${(total / MB).toFixed(0)} MB total, `
			+ `median ${(median / MB).toFixed(2)} MB, heaviest ${heaviest.file} at ${(heaviest.bytes / MB).toFixed(1)} MB `
			+ `(ceiling ${(MAX_SCATTER_PROP_BYTES / MB).toFixed(0)} MB).`,
	);
}

main().catch((error) => {
	console.error(`[scatter-prop-size] FAIL: ${error.message}`);
	process.exit(1);
});
