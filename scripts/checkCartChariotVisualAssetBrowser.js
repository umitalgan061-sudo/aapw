#!/usr/bin/env node
/** Real Three.js browser acceptance for the cart's owner-approved chariot visual upgrade. */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkCartChariotVisualAssetBrowser] Playwright unavailable.');
		process.exit(2);
	}
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	const failures = [];
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		page.on('pageerror', (error) => failures.push(`page:${error.message}`));
		page.on('console', (message) => {
			if (message.type() === 'error') failures.push(`console:${message.text()}`);
		});
		page.on('response', (response) => {
			if (response.status() >= 400) failures.push(`http:${response.status()} ${response.url()}`);
		});

		await page.goto(`http://127.0.0.1:${port}/game3d.html`, {
			waitUntil: 'domcontentloaded', timeout: 60000,
		});

		const proof = await page.evaluate(async () => {
			const { createCartBeing } = await import('/src/3d/gameplay/cartBrain.js');
			const { mulberry32 } = await import('/src/3d/world/terrain.js');
			const edge = {
				fromId: 'visual-proof-a',
				toId: 'visual-proof-b',
				points: [
					{ x: 10, y: 6, z: 10 },
					{ x: 45, y: 6.8, z: 10 },
					{ x: 90, y: 7.2, z: 10 },
				],
				lengthMeters: 80,
			};
			const being = createCartBeing({ cartId: 'cart-visual-proof', edge, mulberry32 });
			const fallbackChildren = [...being.object3D.children];
			const initialRoot = being.object3D.position.clone();
			const result = await being.visualReady;
			const model = result.model || null;
			const localBefore = model?.position?.clone?.() || null;
			for (let i = 0; i < 20; i += 1) being.update(0.1);
			const rootAfter = being.object3D.position.clone();
			const localAfter = model?.position?.clone?.() || null;
			const output = {
				ok: result.ok,
				reason: result.reason || null,
				mode: being.object3D.userData.cartVisualMode,
				preflightBytes: result.preflight?.contentLength || 0,
				material: result.material || null,
				manifest: result.manifest || null,
				bounds: result.bounds || null,
				modelName: model?.name || '',
				modelParented: model?.parent === being.object3D,
				fallbackHidden: fallbackChildren.length > 0 && fallbackChildren.every((child) => child.visible === false),
				rootMoved: initialRoot.distanceTo(rootAfter) > 0.01,
				localStayedBound: Boolean(localBefore && localAfter && localBefore.distanceTo(localAfter) < 1e-9),
				rootFinite: [rootAfter.x, rootAfter.y, rootAfter.z].every(Number.isFinite),
			};
			being.dispose();
			return output;
		});

		assert(proof.ok, `real chariot upgrade failed: ${proof.reason}`);
		assert(proof.mode === 'real-chariot', `cart remained in ${proof.mode} mode`);
		assert(proof.preflightBytes > 1_000_000, `chariot was not hydrated (${proof.preflightBytes} bytes)`);
		assert(proof.modelName.endsWith('-real-chariot'), `unexpected model name: ${proof.modelName}`);
		assert(proof.modelParented, 'real chariot is not parented to the moving cart root');
		assert(proof.fallbackHidden, 'primitive fallback remained visible after real model adoption');
		assert(proof.rootMoved && proof.localStayedBound && proof.rootFinite, 'real chariot did not remain bound to finite road movement');
		assert(proof.material?.meshCount > 0, 'real chariot has no renderable meshes');
		assert(
			proof.material?.texturedMaterialCount > 0 || proof.material?.appearanceCount >= 2,
			`real chariot collapsed to one flat appearance: ${JSON.stringify(proof.material)}`,
		);
		assert(proof.manifest?.validation?.ok, `material manifest failed validation: ${JSON.stringify(proof.manifest?.validation)}`);
		assert(proof.manifest?.placement?.binding === 'existing-road-edge', 'placement manifest lost road-edge binding');
		assert(proof.manifest?.placement?.dynamic === true, 'placement manifest did not mark moving road asset dynamic');
		assert(proof.manifest?.placement?.edge?.fromId === 'visual-proof-a', 'placement manifest lost source road edge');
		const size = proof.bounds?.size;
		assert(size && [size.x, size.y, size.z].every(Number.isFinite), 'normalized chariot bounds are non-finite');
		assert(size.x <= 1.97 && size.z <= 4.32 && size.y <= 2.62, `chariot exceeds road/collision envelope: ${JSON.stringify(size)}`);
		assert(failures.length === 0, `browser errors: ${failures.join(' | ')}`);

		console.log('[checkCartChariotVisualAssetBrowser] PASS', JSON.stringify({
			bytes: proof.preflightBytes,
			material: proof.material,
			bounds: proof.bounds,
			placement: proof.manifest.placement,
		}));
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error('[checkCartChariotVisualAssetBrowser] FAIL', error);
	process.exit(1);
});
