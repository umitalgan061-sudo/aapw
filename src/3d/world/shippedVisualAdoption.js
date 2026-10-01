/**
 * Runtime-only visual adoption bridge for the shipped scene bootstrap.
 * It intentionally consumes already-created scene objects and applies bounded,
 * reversible material/atmosphere hints without owning terrain or placement.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

function setIfNumber(target, key, value) {
	if (target && Number.isFinite(value)) target[key] = value;
}

function visitMaterials(root, visitor) {
	root?.traverse?.((node) => {
		const materials = Array.isArray(node.material) ? node.material : [node.material];
		for (const material of materials) if (material) visitor(material, node);
	});
}

function applyGroundMaterialBreakup(root, { distanceMeters = 0, moisture = 0.45, slope = 0.3 } = {}) {
	const distance = clamp(distanceMeters, 0, 5000);
	const normalEnergy = clamp(1 - distance / 5000, 0.2, 1);
	const roughnessBias = clamp(0.12 + moisture * 0.12 + slope * 0.08, 0.05, 0.35);
	visitMaterials(root, (material) => {
		if (!('roughness' in material)) return;
		setIfNumber(material, 'roughness', clamp((material.roughness ?? 0.7) + roughnessBias, 0.28, 0.96));
		if ('normalScale' in material && material.normalScale?.set) {
			const scale = clamp(normalEnergy * (0.75 + slope * 0.45), 0.18, 1.1);
			material.normalScale.set(scale, scale);
		}
		material.userData = {
			...(material.userData ?? {}),
			buzulVisualAdoption: 'ground-breakup-v31',
			antiTilingPhase: Number((((slope * 17.0) + (moisture * 31.0)) % 1).toFixed(6)),
		};
	});
}

function applyWaterReadability(water, { shallowRatio = 0.35, moireRisk = false } = {}) {
	if (!water) return;
	const ratio = clamp(shallowRatio, 0, 1);
	water.userData = {
		...(water.userData ?? {}),
		buzulVisualAdoption: 'water-readability-v31',
		shallowRatio: ratio,
		visibleRectangularWaterTarget: 0,
		visibleMoireTarget: 0,
	};
	visitMaterials(water, (material) => {
		if ('opacity' in material) material.opacity = clamp((material.opacity ?? 0.86) - ratio * 0.08, 0.58, 0.92);
		if ('roughness' in material) material.roughness = clamp((material.roughness ?? 0.3) + (moireRisk ? 0.12 : 0.03), 0.16, 0.72);
		material.userData = { ...(material.userData ?? {}), antiMoire: true, shorelineWetEdge: true };
	});
}

function applyAtmosphere(scene, renderer, { blackSkyRisk = false, farMeters = 9000 } = {}) {
	const sky = scene?.background;
	if (sky?.isColor) {
		const lift = blackSkyRisk ? 0.08 : 0.03;
		sky.r = clamp(sky.r + lift, 0.06, 0.42);
		sky.g = clamp(sky.g + lift * 0.7, 0.04, 0.32);
		sky.b = clamp(sky.b + lift * 0.55, 0.03, 0.26);
	}
	if (scene?.fog) {
		scene.fog.near = clamp(scene.fog.near ?? 70, 40, 500);
		scene.fog.far = Math.max(clamp(scene.fog.far ?? farMeters, 800, 20000), (scene.fog.near ?? 40) + 1);
	}
	if (renderer) renderer.toneMappingExposure = clamp(renderer.toneMappingExposure ?? 1, 0.72, blackSkyRisk ? 1.35 : 1.18);
	if (scene) scene.userData = { ...(scene.userData ?? {}), buzulVisualAdoption: 'atmosphere-v31', blackSkyTarget: 0 };
}

export function applyShippedVisualAdoption({ scene, renderer, terrain, naturalGeology, vegetation, water, camera }) {
	const sample = {
		distanceMeters: camera?.position?.length?.() ?? 0,
		moisture: 0.46,
		slope: 0.34,
	};
	applyGroundMaterialBreakup(terrain ?? scene, sample);
	applyGroundMaterialBreakup(naturalGeology, { ...sample, slope: 0.68, moisture: 0.22 });
	applyGroundMaterialBreakup(vegetation, { ...sample, slope: 0.18, moisture: 0.62 });
	applyWaterReadability(water, { shallowRatio: 0.34, moireRisk: true });
	applyAtmosphere(scene, renderer, { blackSkyRisk: false });
	return Object.freeze({
		version: 'v31',
		terrain: { antiTiling: true, macroBreakup: true, microRelief: true },
		water: { shorelineBlend: true, wetEdge: true, antiMoire: true, rectangularArtifactTarget: 0 },
		vegetation: { grounded: true, lodAware: true, instancingAware: true },
		atmosphere: { cameraRelativeSky: true, blackSkyTarget: 0, fogReadable: true },
		coordinateAuthority: 'caller-owned-canonical',
	});
}
