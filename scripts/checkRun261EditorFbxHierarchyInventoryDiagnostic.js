#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) process.exit(2);
	const artifactDir = path.join(process.cwd(), 'artifacts', 'run261-editor-fbx-hierarchy-diagnostic');
	fs.mkdirSync(artifactDir, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	const responses404 = [];
	const requestFailures = [];
	const pageErrors = [];
	page.on('response', (response) => {
		if (response.status() === 404) responses404.push(response.url());
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
			const output = [];
			for (const asset of EDITOR_ASSETS.filter((entry) => entry.format === 'fbx')) {
				const root = await manager.loadTemplate(asset);
				let meshCount = 0;
				let boneCount = 0;
				let namedRenderableCount = 0;
				root.traverse((node) => {
					if (node.isMesh) meshCount += 1;
					if (node.isBone) boneCount += 1;
					if (node !== root && !node.isBone && (node.isMesh || node.isGroup) && String(node.name || '').trim()) namedRenderableCount += 1;
				});
				output.push({ id: asset.id, src: asset.src, meshCount, boneCount, namedRenderableCount });
			}
			return output;
		});
		const diagnostics = { report, responses404, requestFailures, pageErrors };
		fs.writeFileSync(path.join(artifactDir, 'diagnostic.json'), JSON.stringify(diagnostics, null, 2));
		console.log(`[checkRun261EditorFbxHierarchyInventoryDiagnostic] FBX=${report.length} 404=${responses404.length} requestFailed=${requestFailures.length} pageErrors=${pageErrors.length}`);
		for (const url of responses404) console.log(`[checkRun261EditorFbxHierarchyInventoryDiagnostic] 404 ${url}`);
		for (const failure of requestFailures) console.log(`[checkRun261EditorFbxHierarchyInventoryDiagnostic] REQUEST_FAILED ${failure.url} :: ${failure.error}`);
		for (const error of pageErrors) console.log(`[checkRun261EditorFbxHierarchyInventoryDiagnostic] PAGE_ERROR ${error}`);
		if (report.length !== 3 || report.some((entry) => entry.meshCount < 1) || requestFailures.length || pageErrors.length) process.exitCode = 1;
	} finally {
		await page.close();
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkRun261EditorFbxHierarchyInventoryDiagnostic] FAIL: ${error.stack || error.message}`);
	process.exit(1);
});
