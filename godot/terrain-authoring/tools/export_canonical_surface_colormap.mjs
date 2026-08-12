#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	WORLD_REFERENCE_BASE_SURFACE_MASK,
	classifyReferenceBaseSurface,
} from '../../../src/3d/world/worldReferenceSurfacePindexes.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const VISUAL_POLICY_PATH = path.join(REPO_ROOT, 'src/3d/world/worldReferenceSurfaceTerrainVisual.js');
const OUTPUT_DIR = path.join(REPO_ROOT, 'godot/terrain-authoring/.generated/iteration_011');
const TGA_PATH = path.join(OUTPUT_DIR, 'canonical_surface_colormap.tga');
const REPORT_PATH = path.join(OUTPUT_DIR, 'canonical_surface_colormap.json');
const SURFACES = Object.freeze(['sea', 'lake', 'soil', 'rock', 'snow']);

function parseCanonicalPalette(source) {
	const palette = {};
	for (const surface of SURFACES) {
		const match = source.match(new RegExp(`\\b${surface}:\\s*0x([0-9a-fA-F]{6})\\b`));
		if (!match) throw new Error(`Missing canonical palette color for ${surface}`);
		const value = Number.parseInt(match[1], 16);
		palette[surface] = Object.freeze({
			hex: `#${match[1].toLowerCase()}`,
			r: (value >> 16) & 0xff,
			g: (value >> 8) & 0xff,
			b: value & 0xff,
		});
	}
	return Object.freeze(palette);
}

function writeTgaPixel(buffer, offset, color) {
	buffer[offset] = color.b;
	buffer[offset + 1] = color.g;
	buffer[offset + 2] = color.r;
	buffer[offset + 3] = 0xff;
}

async function main() {
	const width = WORLD_REFERENCE_BASE_SURFACE_MASK.width;
	const height = WORLD_REFERENCE_BASE_SURFACE_MASK.height;
	if (width !== 96 || height !== 64) throw new Error(`Unexpected canonical mask size ${width}x${height}`);
	if (WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelWidth !== 1536 || WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelHeight !== 1024) {
		throw new Error('Canonical source-map dimensions drifted');
	}

	const visualSource = await readFile(VISUAL_POLICY_PATH, 'utf8');
	if (!visualSource.includes(WORLD_REFERENCE_BASE_SURFACE_MASK.sourceMapSha256)) {
		throw new Error('Canonical surface visual policy no longer references the same map.png SHA-256');
	}
	const palette = parseCanonicalPalette(visualSource);

	const headerSize = 18;
	const bytesPerPixel = 4;
	const tga = Buffer.alloc(headerSize + width * height * bytesPerPixel);
	tga[2] = 2; // Uncompressed true-color image.
	tga.writeUInt16LE(width, 12);
	tga.writeUInt16LE(height, 14);
	tga[16] = 32;
	tga[17] = 0x28; // 8 alpha bits + top-left image origin.

	const counts = Object.fromEntries(SURFACES.map((surface) => [surface, 0]));
	let offset = headerSize;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const normalizedX = (x + 0.5) / width;
			const normalizedY = (y + 0.5) / height;
			const surface = classifyReferenceBaseSurface(normalizedX, normalizedY);
			const color = palette[surface];
			if (!color) throw new Error(`Unsupported canonical surface ${surface} at ${x},${y}`);
			counts[surface] += 1;
			writeTgaPixel(tga, offset, color);
			offset += bytesPerPixel;
		}
	}

	for (const surface of SURFACES) {
		const expected = WORLD_REFERENCE_BASE_SURFACE_MASK.cellCounts[surface];
		if (counts[surface] !== expected) {
			throw new Error(`Canonical ${surface} count drifted: ${counts[surface]} != ${expected}`);
		}
	}

	await mkdir(OUTPUT_DIR, { recursive: true });
	await writeFile(TGA_PATH, tga);
	const sha256 = createHash('sha256').update(tga).digest('hex');
	const report = Object.freeze({
		iteration: 11,
		sourceMapSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.sourceMapSha256,
		sourceDimensions: [WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelWidth, WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelHeight],
		maskSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.maskSha256,
		maskDimensions: [width, height],
		counts,
		palette,
		tgaSha256: sha256,
	});
	await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
	console.log(`CANONICAL_SURFACE_COLORMAP_EXPORT_OK ${width}x${height} sha256=${sha256} counts=${JSON.stringify(counts)}`);
}

main().catch((error) => {
	console.error(error.stack || error.message || error);
	process.exitCode = 1;
});
