#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function isExpectedProjectFbxDirectoryProbe(url) {
	try {
		return decodeURIComponent(new URL(url).pathname) === '/assets/models/fbx_dosyaları/';
	} catch {
		return false;
	}
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) process.exit(2);
	const artifactDir = path.join(process.cwd(), 'artifacts', 'run261-editor-fbx-hierarchy-inventory-v2');
	fs.mkdirSync(artifactDir, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	const unexpectedHttpErrors = [];
	const requestFailures = [];
	const pageErrors = [];
	const expectedDirectoryProbes = [];
	page.on('response', (response) => {
		if (response.status() < 400) return;
		if (response.status() === 404 && isExpectedProjectFbxDirectoryProbe(response.url())) {
			expectedDirectoryProbes.push(response.url());
			return;
		}
		unexpectedHttpErrors.push({ status: response.status(), url: response.url() });
	});
	page.on('requestfailed', (request) => requestFailures.push({ url: request.url(), error: request.failure()?.errorText || '' }));
	page.on('pageerror', (error) => pageErrors.push(error.message));

	try {
		await page.goto(`http://127.0.0.1:${port}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
		await page.waitForSelector('#we-canvas', { timeout: 30000 });
		await page.waitForTimeout(3000);
		const report = await page.evaluate(async () => {
			const [{ EDITOR_ASSETS }, { EditorAssetManager }] = await Promise.all([
				import('/src/3d/editor/editorAssetLibrary.js'),
				import('/src/3d/editor/EditorAssetManager.js'),
			]);
			const manager = new EditorAssetManager();
			const results = [];
			for (const asset of EDITOR_ASSETS.filter((entry) => entry.format === 'fbx')) {
				const root = await manager.loadTemplate(asset);
				let nodeCount = 0;
				let meshCount = 0;
				let groupCount = 0;
				let boneCount = 0;
				let namedRenderableCount = 0;
				const selectableCandidates = [];
				root.traverse((node) => {
					nodeCount += 1;
					if (node.isMesh) meshCount += 1;
					if (node.isGroup) groupCount += 1;
					if (node.isBone) boneCount += 1;
					if (node !== root && !node.isBone && (node.isMesh || node.isGroup) && String(node.name || '').trim()) {
						namedRenderableCount += 1;
						selectableCandidates.push({ name: node.name, type: node.type, childCount: node.children.length });
					}
				});
				results.push({
					id: asset.id,
					name: asset.name,
					src: asset.src,
					nodeCount,
					meshCount,
					groupCount,
					boneCount,
					namedRenderableCount,
					topLevelChildren: root.children.map((child) => ({ name: child.name || '', type: child.type, childCount: child.children.length })),
					selectableCandidates: selectableCandidates.slice(0, 100),
				});
			}
			return results;
		});

		assert(report.length === 3, `expected 3 catalog FBX assets, got ${report.length}`);
		for (const asset of report) {
			assert(asset.nodeCount > 1, `${asset.id} hierarchy did not load`);
			assert(asset.meshCount > 0, `${asset.id} has no renderable mesh`);
			console.log(`[checkRun261EditorFbxHierarchyInventoryV2] ${asset.id}: nodes=${asset.nodeCount} meshes=${asset.meshCount} groups=${asset.groupCount} bones=${asset.boneCount} namedCandidates=${asset.namedRenderableCount}`);
		}
		const multiPart = report.filter((asset) => asset.meshCount > 1 || asset.namedRenderableCount > 1);
		assert(multiPart.length > 0, 'expected at least one FBX asset with multiple selectable renderable nodes');
		assert(expectedDirectoryProbes.length <= 1, `unexpected repeated FBX directory probes: ${expectedDirectoryProbes.length}`);
		assert(unexpectedHttpErrors.length === 0, `unexpected HTTP errors: ${JSON.stringify(unexpectedHttpErrors)}`);
		assert(requestFailures.length === 0, `request failures: ${JSON.stringify(requestFailures)}`);
		assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);

		fs.writeFileSync(
			path.join(artifactDir, 'fbx-hierarchy-report.json'),
			JSON.stringify({ report, expectedDirectoryProbes, unexpectedHttpErrors, requestFailures, pageErrors }, null, 2),
		);
		await page.screenshot({ path: path.join(artifactDir, 'editor-desktop.png'), fullPage: true });
		await page.setViewportSize({ width: 390, height: 844 });
		await page.waitForTimeout(500);
		await page.screenshot({ path: path.join(artifactDir, 'editor-mobile.png'), fullPage: true });
		console.log(`[checkRun261EditorFbxHierarchyInventoryV2] PASS: ${report.length} FBX assets; ${multiPart.length} multipart candidates; expected directory probe isolated; request/page errors zero.`);
	} finally {
		await page.close();
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkRun261EditorFbxHierarchyInventoryV2] FAIL: ${error.stack || error.message}`);
	process.exit(1);
});
