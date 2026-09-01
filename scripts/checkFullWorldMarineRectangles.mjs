#!/usr/bin/env node
/**
 * Pixel-space P0 acceptance probe for the authoritative full-world topdown capture.
 *
 * This is intentionally narrow: it does not judge whether the ocean is attractive and it does not
 * infer geography. It detects the specific shipped failure where a finite water/depth/backdrop
 * layer reads as a large axis-aligned blue rectangle against the darker atmospheric/ocean field.
 * Canonical water authority remains in terrain/hydrology; this script only inspects rendered pixels.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const DEFAULT_INPUT = 'artifacts/full-world-3d-topdown/full-world-3d-topdown.png';
const DEFAULT_REPORT = 'artifacts/full-world-3d-topdown/marine-rectangle-report.json';
const SAMPLE_STRIDE = 5;
const MIN_BLUE = 24;
const MIN_LUMA = 13;
const BLUE_OVER_GREEN = 1.58;
const BLUE_OVER_RED = 2.0;
const MIN_COMPONENT_FRACTION = 0.0045;
const MIN_BBOX_FRACTION = 0.010;
const MIN_FILL_RATIO = 0.46;
const MIN_MAJOR_AXIS_FRACTION = 0.075;
const MAX_ALLOWED_LARGE_RECTANGLES = 0;

function readArg(name, fallback) {
	const prefix = `--${name}=`;
	const found = process.argv.find((arg) => arg.startsWith(prefix));
	return found ? found.slice(prefix.length) : fallback;
}

const inputPath = path.resolve(readArg('input', DEFAULT_INPUT));
const reportPath = path.resolve(readArg('report', DEFAULT_REPORT));
assert(fs.existsSync(inputPath), `topdown image not found: ${inputPath}`);

const browser = await chromium.launch({ headless: true });
let result;
try {
	const page = await browser.newPage();
	const bytes = fs.readFileSync(inputPath);
	const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
	result = await page.evaluate(async ({
		dataUrl,
		stride,
		minBlue,
		minLuma,
		blueOverGreen,
		blueOverRed,
		minComponentFraction,
		minBboxFraction,
		minFillRatio,
		minMajorAxisFraction,
	}) => {
		const image = new Image();
		image.src = dataUrl;
		await image.decode();
		const canvas = document.createElement('canvas');
		canvas.width = image.width;
		canvas.height = image.height;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		context.drawImage(image, 0, 0);
		const pixels = context.getImageData(0, 0, image.width, image.height).data;
		const gridWidth = Math.ceil(image.width / stride);
		const gridHeight = Math.ceil(image.height / stride);
		const gridSize = gridWidth * gridHeight;
		const marine = new Uint8Array(gridSize);
		let marineSamples = 0;
		let blueLumaSum = 0;
		let blueLumaMax = 0;

		for (let gy = 0; gy < gridHeight; gy += 1) {
			const y = Math.min(image.height - 1, gy * stride + Math.floor(stride / 2));
			for (let gx = 0; gx < gridWidth; gx += 1) {
				const x = Math.min(image.width - 1, gx * stride + Math.floor(stride / 2));
				const pixel = (y * image.width + x) * 4;
				const r = pixels[pixel];
				const g = pixels[pixel + 1];
				const b = pixels[pixel + 2];
				const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
				const blueDominant = b >= minBlue
					&& luma >= minLuma
					&& b >= Math.max(1, g) * blueOverGreen
					&& b >= Math.max(1, r) * blueOverRed;
				if (!blueDominant) continue;
				marine[gy * gridWidth + gx] = 1;
				marineSamples += 1;
				blueLumaSum += luma;
				blueLumaMax = Math.max(blueLumaMax, luma);
			}
		}

		const visited = new Uint8Array(gridSize);
		const components = [];
		const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
		for (let start = 0; start < gridSize; start += 1) {
			if (!marine[start] || visited[start]) continue;
			const queue = [start];
			visited[start] = 1;
			let read = 0;
			let count = 0;
			let minX = gridWidth;
			let maxX = -1;
			let minY = gridHeight;
			let maxY = -1;
			let frameSamples = 0;
			while (read < queue.length) {
				const index = queue[read++];
				const y = Math.floor(index / gridWidth);
				const x = index - y * gridWidth;
				count += 1;
				minX = Math.min(minX, x);
				maxX = Math.max(maxX, x);
				minY = Math.min(minY, y);
				maxY = Math.max(maxY, y);
				if (x <= 1 || y <= 1 || x >= gridWidth - 2 || y >= gridHeight - 2) frameSamples += 1;
				for (const [dx, dy] of neighbors) {
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) continue;
					const next = ny * gridWidth + nx;
					if (!marine[next] || visited[next]) continue;
					visited[next] = 1;
					queue.push(next);
				}
			}
			const bboxWidth = maxX - minX + 1;
			const bboxHeight = maxY - minY + 1;
			const bboxArea = bboxWidth * bboxHeight;
			const componentFraction = count / gridSize;
			const bboxFraction = bboxArea / gridSize;
			const fillRatio = count / Math.max(1, bboxArea);
			const majorAxisFraction = Math.max(bboxWidth / gridWidth, bboxHeight / gridHeight);
			const touchesFrame = frameSamples > 0;
			const suspicious = touchesFrame
				&& componentFraction >= minComponentFraction
				&& bboxFraction >= minBboxFraction
				&& fillRatio >= minFillRatio
				&& majorAxisFraction >= minMajorAxisFraction;
			components.push({
				count,
				componentFraction,
				bboxFraction,
				fillRatio,
				majorAxisFraction,
				touchesFrame,
				suspicious,
				bboxPixels: {
					x: minX * stride,
					y: minY * stride,
					width: Math.min(image.width - minX * stride, bboxWidth * stride),
					height: Math.min(image.height - minY * stride, bboxHeight * stride),
				},
			});
		}

		components.sort((a, b) => b.count - a.count);
		const suspicious = components.filter((component) => component.suspicious);
		return {
			width: image.width,
			height: image.height,
			stride,
			gridWidth,
			gridHeight,
			marineSamples,
			marineSampleFraction: marineSamples / gridSize,
			meanMarineLuma: marineSamples ? blueLumaSum / marineSamples : 0,
			maxMarineLuma: blueLumaMax,
			componentCount: components.length,
			suspiciousRectangleCount: suspicious.length,
			suspiciousRectangles: suspicious.slice(0, 12),
			largestComponents: components.slice(0, 12),
		};
	}, {
		dataUrl,
		stride: SAMPLE_STRIDE,
		minBlue: MIN_BLUE,
		minLuma: MIN_LUMA,
		blueOverGreen: BLUE_OVER_GREEN,
		blueOverRed: BLUE_OVER_RED,
		minComponentFraction: MIN_COMPONENT_FRACTION,
		minBboxFraction: MIN_BBOX_FRACTION,
		minFillRatio: MIN_FILL_RATIO,
		minMajorAxisFraction: MIN_MAJOR_AXIS_FRACTION,
	});
} finally {
	await browser.close();
}

const report = {
	status: result.suspiciousRectangleCount <= MAX_ALLOWED_LARGE_RECTANGLES ? 'pass' : 'fail',
	policy: 'full-world-marine-rectangle-pixel-acceptance-2026-09-01-v1',
	thresholds: {
		sampleStride: SAMPLE_STRIDE,
		minBlue: MIN_BLUE,
		minLuma: MIN_LUMA,
		blueOverGreen: BLUE_OVER_GREEN,
		blueOverRed: BLUE_OVER_RED,
		minComponentFraction: MIN_COMPONENT_FRACTION,
		minBboxFraction: MIN_BBOX_FRACTION,
		minFillRatio: MIN_FILL_RATIO,
		minMajorAxisFraction: MIN_MAJOR_AXIS_FRACTION,
		maxAllowedLargeRectangles: MAX_ALLOWED_LARGE_RECTANGLES,
	},
	...result,
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
assert.equal(
	report.suspiciousRectangleCount,
	MAX_ALLOWED_LARGE_RECTANGLES,
	`visible large axis-aligned marine rectangle candidates remain: ${report.suspiciousRectangleCount}`,
);
