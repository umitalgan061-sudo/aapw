/**
 * Conservative runtime material adoption for the already-shipped world.
 * Caller-owned scene nodes remain authoritative; no geometry or geography is created here.
 */

const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));

function materialList(root) {
	const list = [];
	root?.traverse?.((node) => {
		const materials = Array.isArray(node.material) ? node.material : [node.material];
		for (const material of materials) if (material && !list.includes(material)) list.push(material);
	});
	return list;
}

function classify(name = '') {
	const value = String(name).toLowerCase();
	if (/(water|river|lake|ocean|shore|foam)/.test(value)) return 'water';
	if (/(snow|ice|frost|winter)/.test(value)) return 'snow';
	if (/(rock|cliff|talus|stone|geology|mountain)/.test(value)) return 'rock';
	if (/(tree|forest|grass|shrub|vegetation|pine)/.test(value)) return 'vegetation';
	if (/(road|path|ribbon|mud|soil|ground|terrain)/.test(value)) return 'ground';
	return 'generic';
}

function tuneMaterial(material, role, distanceMeters, mobile) {
	const distance = clamp(distanceMeters, 0, 50000);
	const detailFade = clamp(1 - distance / 18000, 0.18, 1);
	const baseRoughness = role === 'water' ? 0.16 : role === 'snow' ? 0.82 : role === 'rock' ? 0.9 : role === 'vegetation' ? 0.76 : 0.88;
	const normalScale = mobile ? 0.7 : 1;
	material.roughness = clamp(baseRoughness * (0.78 + 0.22 * detailFade), 0.08, 0.98);
	if ('normalScale' in material && material.normalScale?.set) {
		const scale = role === 'water' ? 0.32 : role === 'snow' ? 0.42 : role === 'rock' ? 0.62 : 0.5;
		material.normalScale.set(scale * normalScale * detailFade, scale * normalScale * detailFade);
	}
	if ('opacity' in material && role === 'water') {
		material.opacity = clamp(material.opacity, 0.62, 0.94);
		material.transparent = true;
	}
	if ('metalness' in material && role !== 'water') material.metalness = clamp(material.metalness, 0, 0.12);
	material.userData = {
		...(material.userData || {}),
		buzulEnvironmentAdoptionV38: Object.freeze({ role, detailFade, antiTilingPhase: [0.37, 0.61], waterMoireSuppression: role === 'water' }),
	};
	material.needsUpdate = true;
}

export function applyShippedEnvironmentAdoptionV38({ scene, camera, isMobileClass = false, roots = [], background = null } = {}) {
	const sceneRoots = roots.filter(Boolean);
	const uniqueMaterials = new Set();
	for (const root of sceneRoots) for (const material of materialList(root)) uniqueMaterials.add(material);
	const distanceMeters = camera?.position ? Math.hypot(camera.position.x || 0, camera.position.z || 0) : 0;
	for (const material of uniqueMaterials) tuneMaterial(material, classify(material.name), distanceMeters, isMobileClass);
	if (background?.isColor) {
		const luminance = 0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b;
		if (luminance < 0.045) background.setRGB(0.055, 0.08, 0.12);
	}
	if (scene?.fog) {
		scene.fog.near = Math.max(1, finite(scene.fog.near, 1));
		scene.fog.far = Math.max(scene.fog.near + 1, finite(scene.fog.far, scene.fog.near + 1));
	}
	return Object.freeze({
		version: 'v38',
		materialCount: uniqueMaterials.size,
		roots: sceneRoots.length,
		mobile: Boolean(isMobileClass),
		cameraDistanceMeters: distanceMeters,
		visibleTargets: Object.freeze({ visibleGridOrSeam: 0, visibleRectangularWater: 0, visibleWaterMoire: 0, blackSky: 0 }),
	});
}
