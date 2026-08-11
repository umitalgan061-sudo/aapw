#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) process.exit(2);
	const artifactDir = path.join(process.cwd(), 'artifacts', 'run261-editor-fbx-hierarchy-inventory');
	fs.mkdirSync(artifactDir, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	const browserErrors = [];
	page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
	page.on('console', (message) => {
		if (message.type() === 'error') browserErrors.push(`console.error: ${message.text()}`);
	});

	try {
		await page.goto(`http://127.0.0.1:${port}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
		await page.waitForSelector('#we-canvas', { timeout: 30000 });
		await page.waitForTimeout(4000);

		const report = await page.evaluate(async () => {
			const [{ EDITOR_ASSETS }, { EditorAssetManager }] = await Promise.all([
				import('/src/3d/editor/editorAssetLibrary.js'),
				import('/src/3d/editor/EditorAssetManager.js'),
			]);
			const manager = new EditorAssetManager();
			const fbxAssets = EDITOR_ASSETS.filter((asset) => asset.format === 'fbx');
			const results = [];
			for (const asset of fbxAssets) {
				const root = await manager.loadTemplate(asset);
				let nodeCount = 0;
				let meshCount = 0;
				let groupCount = 0;
				let boneCount = 0;
				let namedRenderableCount = 0;
				const namedRenderableNodes = [];
				root.traverse((node) => {
					nodeCount += 1;
					if (node.isMesh) meshCount += 1;
					if (node.isGroup) groupCount += 1;
					if (node.isBone) boneCount += 1;
					if (node !== root && !node.isBone && (node.isMesh || node.isGroup) && String(node.name || '').trim()) {
						namedRenderableCount += 1;
						namedRenderableNodes.push({ name: node.name, type: node.type, childCount: node.children.length });
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
					namedRenderableNodes: namedRenderableNodes.slice(0, 80),
				});
			}
			return results;
		});

		assert(report.length === 3, `expected 3 catalog FBX assets, got ${report.length}`);
		for (const asset of report) {
			assert(asset.nodeCount > 1, `${asset.id} hierarchy did not load`);
			assert(asset.meshCount > 0, `${asset.id} has no renderable mesh`);
		}
		const multiPart = report.filter((asset) => asset.meshCount > 1 || asset.namedRenderableCount > 1);
		assert(multiPart.length > 0, 'expected at least one FBX asset with multiple selectable renderable nodes');
		fs.writeFileSync(path.join(artifactDir, 'fbx-hierarchy-report.json'), JSON.stringify(report, null, 2));

		await page.screenshot({ path: path.join(artifactDir, 'editor-desktop.png'), fullPage: true });
		await page.setViewportSize({ width: 390, height: 844 });
		await page.waitForTimeout(500);
		await page.screenshot({ path: path.join(artifactDir, 'editor-mobile.png'), fullPage: true });
		assert(browserErrors.length === 0, `browser errors: ${browserErrors.join(' | ')}`);
		console.log(`[checkRun261EditorFbxHierarchyInventory] PASS: ${report.length} FBX assets loaded; ${multiPart.length} expose multi-part hierarchy candidates; console zero.`);
	} finally {
		await page.close();
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkRun261EditorFbxHierarchyInventory] FAIL: ${error.stack || error.message}`);
	process.exit(1);
});
