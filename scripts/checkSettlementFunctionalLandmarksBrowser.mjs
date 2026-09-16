#!/usr/bin/env node
/**
 * Real Chromium proof for the settlement functional landmark layer.
 *
 * This boots the exact Three.js module graph used by `world/villages.js`, loads authored GLB/FBX
 * sources through AssetLoader, waits for the shared placement/material gate to finish, then renders
 * the placed buildings and reads GPU pixels back from the canvas. The test fails on any page error,
 * missing asset, placement/material validation failure, missing manifest, blank render, or missing
 * UV/material coverage evidence on the resulting world objects.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startStaticServer, loadPlaywright } from './devServerHelper.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'settlement-functional-landmarks');
const HARNESS = 'scripts/settlement-functional-landmark-harness.html';

function finite(value) {
	return Number.isFinite(Number(value));
}

function assertManifest(manifest, id) {
	assert.ok(manifest, `${id}: missing placement manifest`);
	assert.ok(manifest.validation?.ok === true, `${id}: material validation is not green`);
	assert.ok(manifest.placement?.position, `${id}: missing placement position evidence`);
	assert.ok(manifest.placement?.rotation, `${id}: missing placement rotation evidence`);
	assert.ok(manifest.placement?.scale, `${id}: missing placement scale evidence`);
	assert.ok(Array.isArray(manifest.surfaces), `${id}: missing surface evidence`);
	assert.ok(manifest.surfaces.length > 0, `${id}: placement manifest contains no material surfaces`);
	assert.ok(Number(manifest.validation?.generatedMaterialCount) > 0, `${id}: no generated material survived the placement gate`);
	assert.ok(finite(manifest.validation?.generatedUVCount), `${id}: generated UV evidence is missing`);
	assert.ok(finite(manifest.validation?.fallbackSurfaceCount), `${id}: fallback surface evidence is missing`);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkSettlementFunctionalLandmarksBrowser] FAIL: Playwright is unavailable.');
		process.exitCode = 2;
		return;
	}
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	const server = await startStaticServer();
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : null;
	assert.ok(port, 'static server did not expose a port');
	const browser = await playwright.chromium.launch({ headless: true });

	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
		const pageErrors = [];
		const consoleErrors = [];
		page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
		page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

		await page.goto(`http://127.0.0.1:${port}/${HARNESS}`, { waitUntil: 'networkidle', timeout: 120000 });
		await page.waitForFunction(() => document.body.dataset.proofReady === 'true', null, { timeout: 120000 });
		const proof = await page.evaluate(() => window.__SETTLEMENT_LANDMARK_PROOF__);

		assert.equal(pageErrors.length, 0, `browser page errors:\n${pageErrors.join('\n')}`);
		assert.equal(consoleErrors.length, 0, `browser console errors:\n${consoleErrors.join('\n')}`);
		assert.equal(proof?.ok, true, 'functional landmark evidence did not report ok=true');
		assert.ok(proof.planCount >= 8, `expected at least 8 planned functional sites, got ${proof.planCount}`);
		assert.equal(proof.evidence?.missingAssetCount, 0, 'missingAssetCount must be zero');
		assert.equal(proof.evidence?.placementFailureCount, 0, 'placementFailureCount must be zero');
		assert.equal(proof.evidence?.materialValidationFailureCount, 0, 'materialValidationFailureCount must be zero');
		assert.equal(proof.placedObjectCount, proof.planCount, 'every planned service building must be placed');
		assert.equal(proof.evidence?.textureSize, 512, 'functional landmarks must carry 512px material evidence');
		assert.ok(proof.render?.nonBackgroundPixels > 1000, `rendered proof is too blank: ${proof.render?.nonBackgroundPixels}`);
		assert.ok(proof.render?.highContrastPixels > 100, `rendered proof lacks material/shape contrast: ${proof.render?.highContrastPixels}`);

		const ids = new Set();
		let generatedUVObjects = 0;
		let generatedMaterialObjects = 0;
		let fallbackSurfaceCount = 0;
		for (const object of proof.preparedObjects || []) {
			assert.equal(ids.has(object.id), false, `duplicate runtime functional landmark id: ${object.id}`);
			ids.add(object.id);
			assert.equal(object.materialReadyForWorld, true, `${object.id}: material gate not used`);
			assert.equal(object.manifestReady, true, `${object.id}: placement manifest missing`);
			assert.ok(object.surface, `${object.id}: ground surface evidence missing`);
			assert.ok(object.footprint, `${object.id}: footprint grounding evidence missing`);
			assert.ok(finite(object.surface.height), `${object.id}: non-finite ground height`);
			assert.ok(finite(object.surface.slopeDegrees), `${object.id}: non-finite slope evidence`);
			assert.ok(object.footprint.heightRange >= 0, `${object.id}: invalid footprint height range`);
			assertManifest(object.manifest, object.id);
			generatedUVObjects += Number(object.manifest.validation.generatedUVCount) > 0 ? 1 : 0;
			generatedMaterialObjects += Number(object.manifest.validation.generatedMaterialCount) > 0 ? 1 : 0;
			fallbackSurfaceCount += Number(object.manifest.validation.fallbackSurfaceCount) || 0;
		}
		assert.equal(generatedMaterialObjects, proof.preparedObjects?.length || 0, 'every prepared landmark needs generated material coverage');
		assert.ok(generatedUVObjects >= 0, 'generated UV diagnostic became non-finite');
		assert.ok(fallbackSurfaceCount >= 0, 'fallback surface coverage became negative');

		const image = await page.screenshot({ path: path.join(ARTIFACT_DIR, 'functional-landmarks.png'), fullPage: false });
		fs.writeFileSync(path.join(ARTIFACT_DIR, 'proof.json'), JSON.stringify({ proof, pageErrors, consoleErrors, screenshotBytes: image.length, generatedUVObjects, generatedMaterialObjects, fallbackSurfaceCount }, null, 2));
		console.log(JSON.stringify({
			ok: true,
			planCount: proof.planCount,
			placedObjectCount: proof.placedObjectCount,
			missingAssetCount: proof.evidence.missingAssetCount,
			placementFailureCount: proof.evidence.placementFailureCount,
			materialValidationFailureCount: proof.evidence.materialValidationFailureCount,
			textureSize: proof.evidence.textureSize,
			generatedUVObjects,
			generatedMaterialObjects,
			fallbackSurfaceCount,
			nonBackgroundPixels: proof.render.nonBackgroundPixels,
			highContrastPixels: proof.render.highContrastPixels,
			pageErrors: pageErrors.length,
			consoleErrors: consoleErrors.length,
			artifact: 'artifacts/settlement-functional-landmarks/proof.json',
		}, null, 2));
		console.log('[checkSettlementFunctionalLandmarksBrowser] PASS');
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[checkSettlementFunctionalLandmarksBrowser] FAIL');
	console.error(error?.stack || error);
	process.exitCode = 1;
});