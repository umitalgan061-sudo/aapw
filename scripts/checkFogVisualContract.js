#!/usr/bin/env node
/**
 * checkFogVisualContract.js — live-browser distance-fog regression contract.
 * Pins the existing FogExp2 type, day/night density interpolation, horizon-color copy semantics,
 * and representative near/mid/far atmospheric falloff without changing runtime behavior.
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkFogVisualContract] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createFog, updateFog } = await import('/src/3d/fog.js');
			const fail = (condition, message) => { if (!condition) throw new Error(message); };
			const close = (a, b, tolerance = 1e-12) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
			const fogFactor = (density, distance) => 1 - Math.exp(-(density * density) * distance * distance);
			const first = createFog();
			const twin = createFog();

			fail(first?.isFogExp2 === true && twin?.isFogExp2 === true, 'fog output is not THREE.FogExp2');
			fail(first !== twin && first.color !== twin.color, 'fog instances share mutable state');
			fail(first.color?.isColor === true && first.color.getHex() === 0x000000, 'fog placeholder color drifted');
			fail(close(first.density, 0.0004), `day density ${first.density} != 0.0004`);
			fail(close(twin.density, 0.0004), `twin day density ${twin.density} != 0.0004`);

			const dayHorizon = new THREE.Color(0x9fc7e8);
			updateFog(first, { horizonColor: dayHorizon, nightFactor: 0 });
			fail(first.color !== dayHorizon && first.color.getHex() === 0x9fc7e8, 'day horizon color must be copied, not retained by reference');
			fail(close(first.density, 0.0004), `day update density ${first.density} != 0.0004`);
			dayHorizon.set(0xffffff);
			fail(first.color.getHex() === 0x9fc7e8, 'fog retained caller day horizon color by reference');

			const duskHorizon = new THREE.Color(0x8a6b70);
			updateFog(first, { horizonColor: duskHorizon, nightFactor: 0.5 });
			fail(first.color.getHex() === 0x8a6b70, 'dusk horizon color drifted');
			fail(close(first.density, 0.000475), `half-night density ${first.density} != 0.000475`);

			const nightHorizon = new THREE.Color(0x101a2d);
			updateFog(first, { horizonColor: nightHorizon, nightFactor: 1 });
			fail(first.color !== nightHorizon && first.color.getHex() === 0x101a2d, 'night horizon color copy contract drifted');
			fail(close(first.density, 0.00055), `night density ${first.density} != 0.00055`);
			nightHorizon.set(0x000000);
			fail(first.color.getHex() === 0x101a2d, 'fog retained caller night horizon color by reference');

			const dayDensity = twin.density;
			const nightDensity = first.density;
			const dayNear = fogFactor(dayDensity, 500);
			const dayMid = fogFactor(dayDensity, 1000);
			const dayFar = fogFactor(dayDensity, 2000);
			const nightNear = fogFactor(nightDensity, 500);
			const nightMid = fogFactor(nightDensity, 1000);
			const nightFar = fogFactor(nightDensity, 2000);
			fail(dayNear < dayMid && dayMid < dayFar, 'day fog falloff is not monotonic with distance');
			fail(nightNear < nightMid && nightMid < nightFar, 'night fog falloff is not monotonic with distance');
			fail(nightNear > dayNear && nightMid > dayMid && nightFar > dayFar, 'night fog must be denser at representative distances');
			fail(dayNear < 0.05, `500m day fog factor ${dayNear} is no longer essentially clear`);
			fail(dayMid > 0.12 && dayMid < 0.18, `1000m day fog factor ${dayMid} left light-haze band`);
			fail(dayFar > 0.45 && dayFar < 0.50, `2000m day fog factor ${dayFar} left far-edge band`);
			fail(nightFar > 0.68 && nightFar < 0.72, `2000m night fog factor ${nightFar} left reduced-visibility band`);

			updateFog(twin, { horizonColor: new THREE.Color(0x445566), nightFactor: 0.25 });
			fail(close(twin.density, 0.0004375), `quarter-night density ${twin.density} != 0.0004375`);
			fail(twin.color.getHex() === 0x445566, 'twin update color drifted');
			fail(close(first.density, 0.00055) && first.color.getHex() === 0x101a2d, 'updating twin mutated first fog instance');

			return { dayDensity, nightDensity, dayNear, dayMid, dayFar, nightFar };
		});
		assert(result.dayDensity === 0.0004 && result.nightDensity === 0.00055, 'fog density endpoints escaped browser contract');
		console.log(`[checkFogVisualContract] PASS: FogExp2 day/night density ${result.dayDensity.toFixed(5)}→${result.nightDensity.toFixed(5)}, horizon-color copy PASS, 500/1000/2000m day factors ${(result.dayNear * 100).toFixed(1)}%/${(result.dayMid * 100).toFixed(1)}%/${(result.dayFar * 100).toFixed(1)}%, 2000m night ${(result.nightFar * 100).toFixed(1)}%.`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkFogVisualContract] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
