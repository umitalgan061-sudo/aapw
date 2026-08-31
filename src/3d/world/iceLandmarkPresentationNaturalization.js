import * as THREE from 'three';

function hash01(index, salt, seed) {
	let value = Math.imul((index | 0) ^ seed, 0x27d4eb2d) ^ Math.imul(salt + seed, 0x165667b1);
	value ^= value >>> 15;
	value = Math.imul(value, 0x85ebca6b);
	value ^= value >>> 13;
	return (value >>> 0) / 0x100000000;
}

function softenPrimaryIceTint(mesh, seed) {
	const position = mesh?.geometry?.getAttribute?.('position');
	const color = mesh?.geometry?.getAttribute?.('color');
	if (!position || !color) return 0;
	for (let index = 0; index < position.count; index += 1) {
		const x = position.getX(index);
		const y = position.getY(index);
		const z = position.getZ(index);
		const broad = Math.sin(x * 0.0059 + z * 0.0041 + y * 0.0017 + seed * 0.00013) * 0.5 + 0.5;
		const cross = Math.sin(x * 0.0197 - z * 0.0131 + y * 0.0063 + seed * 0.00031) * 0.5 + 0.5;
		const value = THREE.MathUtils.clamp(0.93 + broad * 0.045 + cross * 0.025, 0.92, 1.0);
		color.setXYZ(index, value * 0.988, value, Math.min(1, value * 1.006));
	}
	color.needsUpdate = true;
	mesh.userData.primaryIceVertexTint = 'continuous-near-neutral-v14';
	return position.count;
}

function smoothWallSectionNormals(group) {
	const wall = group.getObjectByName('the-wall-natural-ice-cliff');
	const position = wall?.geometry?.getAttribute?.('position');
	const normal = wall?.geometry?.getAttribute?.('normal');
	if (!position || !normal || position.count < 12 || position.count % 4 !== 0) return 0;
	const sectionCount = position.count / 4;
	const facing = [];
	for (let index = 0; index < sectionCount; index += 1) {
		const base = index * 4;
		const frontX = (position.getX(base) + position.getX(base + 1)) * 0.5;
		const frontZ = (position.getZ(base) + position.getZ(base + 1)) * 0.5;
		const backX = (position.getX(base + 2) + position.getX(base + 3)) * 0.5;
		const backZ = (position.getZ(base + 2) + position.getZ(base + 3)) * 0.5;
		facing.push(new THREE.Vector3(frontX - backX, 0, frontZ - backZ).normalize());
	}
	const averaged = new THREE.Vector3();
	for (let index = 0; index < sectionCount; index += 1) {
		averaged.set(0, 0, 0);
		for (let neighbour = Math.max(0, index - 2); neighbour <= Math.min(sectionCount - 1, index + 2); neighbour += 1) averaged.add(facing[neighbour]);
		averaged.normalize();
		const base = index * 4;
		normal.setXYZ(base, averaged.x, 0.04, averaged.z);
		normal.setXYZ(base + 1, averaged.x * 0.94, 0.34, averaged.z * 0.94);
		normal.setXYZ(base + 2, -averaged.x, 0.04, -averaged.z);
		normal.setXYZ(base + 3, -averaged.x * 0.94, 0.34, -averaged.z * 0.94);
	}
	normal.needsUpdate = true;
	wall.userData.wallSectionNormalNaturalization = 'five-section-glacial-blend-v15';
	return position.count;
}

function extendContinuousIceShader(mesh, seed) {
	const material = mesh?.material;
	if (!material) return false;
	const prior = material.onBeforeCompile;
	material.onBeforeCompile = (shader, renderer) => {
		if (prior) prior.call(material, shader, renderer);
		if (!shader.fragmentShader.includes('vIceWorldPosition') || !shader.fragmentShader.includes('iceNoise')) return;
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <color_fragment>', `#include <color_fragment>
float icePresentationBroad=iceNoise((vIceWorldPosition.xz+vIceWorldPosition.yy*0.17)/73.0);
float icePresentationMeso=iceNoise((vIceWorldPosition.xz+vec2(vIceWorldPosition.y*0.29,-vIceWorldPosition.y*0.13))/23.0);
float icePresentationFine=iceNoise((vIceWorldPosition.xz+vec2(-31.0,17.0))/6.8);
diffuseColor.rgb*=clamp(0.955+(icePresentationBroad-0.5)*0.10+(icePresentationMeso-0.5)*0.075+(icePresentationFine-0.5)*0.035,0.86,1.08);`)
			.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
vec2 icePresentationP=vIceWorldPosition.xz/7.4+vec2(vIceWorldPosition.y*0.019,-vIceWorldPosition.y*0.013);
float icePresentationNx=iceNoise(icePresentationP+vec2(0.21,0.0))-iceNoise(icePresentationP-vec2(0.21,0.0));
float icePresentationNz=iceNoise(icePresentationP+vec2(0.0,0.21))-iceNoise(icePresentationP-vec2(0.0,0.21));
normal=normalize(normal+mat3(viewMatrix)*vec3(icePresentationNx,0.0,icePresentationNz)*0.085);`);
	};
	const priorKey = material.customProgramCacheKey?.bind(material);
	material.customProgramCacheKey = () => `${priorKey ? priorKey() : ''}|ice-presentation-v14-${Math.abs(seed) % 4093}`;
	material.needsUpdate = true;
	mesh.userData.continuousIcePresentationShader = 'world-space-albedo-normal-v14';
	return true;
}

function naturalizePrimaryIcicles(group, seed) {
	const mesh = group.getObjectByName('ice-cave-icicles');
	if (!mesh?.isInstancedMesh) return 0;
	const matrix = new THREE.Matrix4();
	const position = new THREE.Vector3();
	const quaternion = new THREE.Quaternion();
	const scale = new THREE.Vector3();
	const newScale = new THREE.Vector3();
	for (let index = 0; index < mesh.count; index += 1) {
		mesh.getMatrixAt(index, matrix);
		matrix.decompose(position, quaternion, scale);
		const ceilingY = position.y + 2.1 * scale.y;
		const lengthScale = scale.y * (0.30 + hash01(index, 31, seed) * 0.24);
		const radialScale = scale.y * (0.14 + hash01(index, 37, seed) * 0.10);
		position.y = ceilingY - 2.1 * lengthScale;
		quaternion.setFromEuler(new THREE.Euler(
			Math.PI + (hash01(index, 41, seed) - 0.5) * 0.13,
			hash01(index, 43, seed) * Math.PI * 2,
			(hash01(index, 47, seed) - 0.5) * 0.18,
		));
		newScale.set(radialScale, lengthScale, radialScale * (0.82 + hash01(index, 53, seed) * 0.28));
		matrix.compose(position, quaternion, newScale);
		mesh.setMatrixAt(index, matrix);
	}
	mesh.instanceMatrix.needsUpdate = true;
	mesh.userData.primaryIcicleNaturalization = 'ceiling-anchored-fine-taper-v15';
	return mesh.count;
}

function naturalizeMeltRibbon(group, seed) {
	const mesh = group.getObjectByName('ice-cave-wet-melt-ribbon');
	const position = mesh?.geometry?.getAttribute?.('position');
	if (!position || position.count < 4) return 0;
	for (let index = 0; index + 1 < position.count; index += 2) {
		const ax = position.getX(index); const az = position.getZ(index);
		const bx = position.getX(index + 1); const bz = position.getZ(index + 1);
		const cx = (ax + bx) * 0.5; const cz = (az + bz) * 0.5;
		const hx = (ax - bx) * 0.5; const hz = (az - bz) * 0.5;
		const half = Math.hypot(hx, hz) || 1;
		const ux = hx / half; const uz = hz / half;
		const width = 0.56 + hash01(index, 61, seed) * 0.68;
		const wander = (hash01(index, 67, seed) - 0.5) * Math.min(1.5, half * 0.34);
		const mx = cx + ux * wander; const mz = cz + uz * wander;
		position.setX(index, mx + ux * half * width); position.setZ(index, mz + uz * half * width);
		position.setX(index + 1, mx - ux * half * width); position.setZ(index + 1, mz - uz * half * width);
	}
	position.needsUpdate = true;
	mesh.geometry.computeVertexNormals();
	mesh.geometry.computeBoundingBox();
	mesh.geometry.computeBoundingSphere();
	if (mesh.material) {
		mesh.material.color.set(0x5d777b);
		mesh.material.roughness = 0.42;
		mesh.material.clearcoat = 0.12;
		mesh.material.transmission = Math.min(0.012, mesh.material.transmission || 0);
		mesh.material.needsUpdate = true;
	}
	mesh.userData.meltRibbonNaturalization = 'meandering-variable-width-v14';
	return position.count;
}

export function naturalizeIceLandmarkPresentation({ group, seed }) {
	const wallSmoothedNormalVertexCount = smoothWallSectionNormals(group);
	let primarySurfaceVertexCount = 0;
	let shaderSurfaceCount = 0;
	for (const name of ['the-wall-natural-ice-cliff', 'ice-cave-shell', 'ice-wall-cave-portal']) {
		const mesh = group.getObjectByName(name);
		primarySurfaceVertexCount += softenPrimaryIceTint(mesh, seed + name.length * 101);
		if (extendContinuousIceShader(mesh, seed + name.length * 211)) shaderSurfaceCount += 1;
	}
	return Object.freeze({
		primarySurfaceVertexCount,
		shaderSurfaceCount,
		wallSmoothedNormalVertexCount,
		primaryIcicleCount: naturalizePrimaryIcicles(group, seed + 14033),
		meltRibbonVertexCount: naturalizeMeltRibbon(group, seed + 14107),
	});
}