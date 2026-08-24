#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

function parseArgs(argv) {
	const args = {
		output: 'artifacts/full-world-3d-topdown/full-world-3d-topdown.png',
		width: 1600,
		height: 1100,
		segments: 240,
		port: 4173,
	};
	for (const token of argv) {
		const [key, value] = token.split('=', 2);
		if (key === '--output') args.output = value;
		else if (key === '--width') args.width = Number(value);
		else if (key === '--height') args.height = Number(value);
		else if (key === '--segments') args.segments = Number(value);
		else if (key === '--port') args.port = Number(value);
	}
	return args;
}

async function waitForServer(url, attempts = 60) {
	let lastError;
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			const response = await fetch(url, { cache: 'no-store' });
			if (response.ok) return;
			lastError = new Error(`HTTP ${response.status}`);
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw lastError ?? new Error('static server did not start');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	assert(Number.isFinite(args.width) && args.width >= 640);
	assert(Number.isFinite(args.height) && args.height >= 480);
	assert(Number.isFinite(args.segments) && args.segments >= 80);
	assert(Number.isInteger(args.port) && args.port > 0);

	const outputPath = path.resolve(repoRoot, args.output);
	const jsonPath = outputPath.replace(/\.png$/i, '.json');
	await fs.mkdir(path.dirname(outputPath), { recursive: true });

	const server = spawn('python3', ['-m', 'http.server', String(args.port), '--bind', '127.0.0.1'], {
		cwd: repoRoot,
		stdio: ['ignore', 'ignore', 'pipe'],
	});
	let serverStderr = '';
	server.stderr.on('data', (chunk) => { serverStderr += chunk.toString(); });

	let browser;
	try {
		const baseUrl = `http://127.0.0.1:${args.port}`;
		const harnessUrl = `${baseUrl}/scripts/fullWorld3DTopdownHarness.html`;
		await waitForServer(harnessUrl);
		browser = await chromium.launch({
			headless: true,
			args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
		});
		const page = await browser.newPage({ viewport: { width: args.width, height: args.height } });
		const pageErrors = [];
		page.on('pageerror', (error) => pageErrors.push(error.message));
		page.on('console', (message) => {
			if (message.type() === 'error') pageErrors.push(`console: ${message.text()}`);
		});
		const url = `${harnessUrl}?width=${args.width}&height=${args.height}&segments=${args.segments}`;
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
		await page.waitForFunction(
			() => window.__FULL_WORLD_3D_TOPDOWN__?.status === 'ready',
			null,
			{ timeout: 120000 },
		);
		const summary = await page.evaluate(() => window.__FULL_WORLD_3D_TOPDOWN__);
		if (pageErrors.length) throw new Error(pageErrors.join('\n'));

		// Always preserve the visual + numeric evidence before semantic assertions. If a future gate
		// fails, reviewers still get the exact frame that failed instead of an empty artifact folder.
		await page.screenshot({ path: outputPath, type: 'png' });
		await fs.writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

		assert.equal(summary.camera.type, 'OrthographicCamera');
		assert.equal(summary.camera.verticalExaggeration, 1, 'QA must render production vertical scale');
		assert(summary.vertexCount > 20000, 'full-world terrain mesh is unexpectedly coarse');
		assert(summary.maxHeightMeters - summary.minHeightMeters > 400, 'major mountain relief is not visible in sampled height range');
		assert(summary.heightStdDevMeters > 20, 'full-world relief variance is unexpectedly flat');
		assert(summary.surfaceCounts.sea > summary.surfaceCounts.lake, 'sea must remain the dominant water class');
		assert(summary.surfaceCounts.lake > 0, 'canonical inland lakes disappeared from full-world sampling');
		assert(summary.northPermanentIceMax >= 0.8, 'authored permanent-ice core disappeared from the north');
		assert(summary.northPermanentIceActiveSamples > 0, 'no strong permanent-ice samples were represented');
		assert(summary.waterDepthField.meanWetCoverage > 0.35, 'production water coverage is unexpectedly sparse');
		assert(summary.waterDepthField.mixedCoastTexelRatio > 0, 'coastline anti-alias coverage disappeared');
		assert.equal(summary.waterLayerComposition.nearDepthWrite, true, 'near swell must retain depth writes');
		assert.equal(summary.waterLayerComposition.farDepthWrite, false, 'far transparent water underlay must not occlude near swell');
		assert(summary.waterLayerComposition.farRenderOrder < 0, 'far water underlay must render before near swell');
		assert(summary.waterLayerComposition.farLocalY < 0, 'far water underlay must remain slightly below near water');
		assert(Math.abs(summary.waterLayerComposition.nearWorldXZ[0] - summary.camera.position[0]) < 1e-6,
			'near-water world X must follow the topdown camera exactly');
		assert(Math.abs(summary.waterLayerComposition.nearWorldXZ[1] - summary.camera.position[2]) < 1e-6,
			'near-water world Z must follow the topdown camera exactly');

		console.log('[captureFullWorld3DTopdown] PASS', JSON.stringify({
			output: path.relative(repoRoot, outputPath),
			json: path.relative(repoRoot, jsonPath),
			vertices: summary.vertexCount,
			heightRange: [summary.minHeightMeters, summary.maxHeightMeters],
			lakeSamples: summary.surfaceCounts.lake,
			northPermanentIceMean: summary.northPermanentIceMean,
			northPermanentIceMax: summary.northPermanentIceMax,
			waterLayers: summary.waterLayerComposition,
		}));
	} finally {
		await browser?.close().catch(() => {});
		server.kill('SIGTERM');
		if (serverStderr && server.exitCode && server.exitCode !== 0) process.stderr.write(serverStderr);
	}
}

main().catch((error) => {
	console.error('[captureFullWorld3DTopdown] FAIL', error);
	process.exitCode = 1;
});
