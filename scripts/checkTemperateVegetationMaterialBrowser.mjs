#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const assetPath = 'assets/models/vegetation/birch_trees_R7qMWzb7nk.glb';
const componentName = 'BirchTree_1';

function parseArgs(argv) {
	const output = argv.find((token) => token.startsWith('--output='))?.slice('--output='.length)
		?? 'artifacts/temperate-vegetation-asset-audit/material-manifest.json';
	return { output };
}

async function waitForServer(url, attempts = 80) {
	let lastError;
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		try {
			const response = await fetch(url, { cache: 'no-store' });
			if (response.ok) return;
			lastError = new Error(`HTTP ${response.status}`);
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw lastError ?? new Error('static server did not start');
}

const { output } = parseArgs(process.argv.slice(2));
const outputPath = path.resolve(repoRoot, output);
const harnessPath = path.join(path.dirname(outputPath), 'material-harness.html');
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(harnessPath, '<!doctype html><script type="importmap">{"imports":{"three":"/src/3d/vendor/three/three.module.js","three/addons/":"/src/3d/vendor/three/addons/"}}</script>\n', 'utf8');

const server = spawn('python3', ['-m', 'http.server', '4179', '--bind', '127.0.0.1'], {
	cwd: repoRoot,
	stdio: ['ignore', 'ignore', 'pipe'],
});
let browser;
try {
	const base = 'http://127.0.0.1:4179';
	await waitForServer(`${base}/${assetPath}`);
	browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
	const harnessUrl = `${base}/${path.relative(repoRoot, harnessPath).replaceAll(path.sep, '/')}`;
	await page.goto(harnessUrl, { waitUntil: 'domcontentloaded' });

	const proof = await page.evaluate(async ({ baseUrl, sourcePath, sourceComponent }) => {
		const [{ AssetLoader }, materialCore, THREE, { upgradeTemperateBroadleafAssets }] = await Promise.all([
			import(`${baseUrl}/src/3d/assetLoader.js`), import(`${baseUrl}/src/3d/materials/MaterialAssignmentCore.js`),
			import('three'), import(`${baseUrl}/src/3d/world/temperateVegetationAsset.js`),
		]);
		const model = await new AssetLoader().loadModel(`${baseUrl}/${sourcePath}`);
		if (model.userData?.isPlaceholder) throw new Error('hydrated birch loaded as placeholder');
		const component = model.getObjectByName(sourceComponent);
		if (!component) throw new Error(`missing qualified component ${sourceComponent}`);
		const validation = materialCore.validateMaterialAssignment(component);
		const manifest = materialCore.createMaterialManifest(component, {
			metadata: {
				id: `temperate-birch:${sourceComponent}`,
				name: sourceComponent,
				category: 'vegetation',
				src: sourcePath,
			},
		});
		const group = new THREE.Group(), matrix = new THREE.Matrix4();
		for (const name of ['vegetation-round-trunks', 'vegetation-round-foliage']) {
			const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial(), 7); mesh.name = name;
			for (let index = 0; index < 7; index++) { matrix.makeTranslation(index * 3, 0, 0); mesh.setMatrixAt(index, matrix); }
			group.add(mesh);
		}
		const upgrade = await upgradeTemperateBroadleafAssets(group);
		return {
			validation: {
				ok: validation.ok,
				errors: validation.errors,
				warnings: validation.warnings,
				meshCount: validation.meshCount,
				surfaceCount: validation.surfaceCount,
				uvMeshCount: validation.uvMeshCount,
				materialSlotCount: validation.materialSlotCount,
			},
			manifest,
			materialNames: manifest.surfaces.map((surface) => surface.material),
			upgrade: { status: upgrade.status, treeCount: upgrade.treeCount, variantCount: upgrade.variantCount, meshCount: upgrade.meshCount, manifestCount: upgrade.manifests?.length, proceduralHidden: !group.getObjectByName('vegetation-round-trunks').visible && !group.getObjectByName('vegetation-round-foliage').visible },
		};
	}, { baseUrl: base, sourcePath: assetPath, sourceComponent: componentName });

	assert.equal(errors.length, 0, `browser/page errors: ${errors.join(' | ')}`);
	assert.equal(proof.validation.ok, true, `shared validation failed: ${proof.validation.errors.join(',')}`);
	assert(proof.validation.meshCount >= 2, 'qualified birch must retain separate renderable bark/leaf surfaces');
	assert(proof.validation.surfaceCount >= 2, 'qualified birch must expose multiple material surfaces');
	assert(proof.validation.uvMeshCount >= 2, 'qualified birch bark/leaf meshes must retain UVs');
	assert(proof.materialNames.includes('BirchTree_Bark'), 'authored birch bark material was not preserved');
	assert(proof.materialNames.includes('BirchTree_Leaves'), 'authored birch leaf material was not preserved');
	assert.equal(proof.manifest.validation.ok, true, 'shared material manifest must remain valid before live placement');
	assert.deepEqual(proof.upgrade, { status: 'active', treeCount: 7, variantCount: 5, meshCount: 10, manifestCount: 5, proceduralHidden: true });
	const result = { contract: 'temperate-birch-shared-material-browser-v2-live-adapter', assetPath, componentName, browserErrors: errors, ...proof };
	await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
	console.log('[checkTemperateVegetationMaterialBrowser] PASS', JSON.stringify(result));
} finally {
	await browser?.close().catch(() => {});
	server.kill('SIGTERM');
}