import * as THREE from 'three';

const BODY_COLOR = new THREE.Color(0x6d7786);
const SELECTED_COLOR = new THREE.Color(0xd7aa3a);
const HELMET_COLOR = new THREE.Color(0x39424d);
const SPEAR_COLOR = new THREE.Color(0x6b4a2a);
const UNIT_COUNT = 48;
const FORMATION_SPACING_METERS = 3.8;
const MOVE_SPEED_MPS = 7.5;
const ARRIVAL_EPSILON_METERS = 0.25;

function mulberry32(seed) {
	let t = seed >>> 0;
	return function next() {
		t += 0x6d2b79f5;
		let x = t;
		x = Math.imul(x ^ (x >>> 15), x | 1);
		x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
	};
}

function setMatrix(mesh, index, position, yOffset, scale, yaw, localOffsetX = 0, localOffsetZ = 0) {
	const c = Math.cos(yaw);
	const s = Math.sin(yaw);
	const ox = localOffsetX * c + localOffsetZ * s;
	const oz = -localOffsetX * s + localOffsetZ * c;
	const matrix = new THREE.Matrix4();
	const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
	matrix.compose(
		new THREE.Vector3(position.x + ox, position.y + yOffset, position.z + oz),
		quaternion,
		scale,
	);
	mesh.setMatrixAt(index, matrix);
}

function formationOffset(index, count, spacing = FORMATION_SPACING_METERS) {
	const columns = Math.ceil(Math.sqrt(count));
	const rows = Math.ceil(count / columns);
	const row = Math.floor(index / columns);
	const column = index % columns;
	return {
		x: (column - (columns - 1) * 0.5) * spacing,
		z: (row - (rows - 1) * 0.5) * spacing,
	};
}

function disposeInstancedMesh(mesh) {
	mesh.geometry.dispose();
	mesh.material.dispose();
}

/**
 * Lightweight RTS army using instancing so dozens of controllable soldiers add only a few draw calls.
 * The logical unit order and initial formation are deterministic for a fixed seed.
 */
export function createRtsArmy({ scene, groundCollider, center, seed }) {
	const random = mulberry32(seed);
	const units = [];
	const group = new THREE.Group();
	group.name = 'rts-army';

	const bodyGeometry = new THREE.CylinderGeometry(0.48, 0.58, 1.55, 8);
	const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.05 });
	const bodies = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, UNIT_COUNT);
	bodies.name = 'rts-soldier-bodies';
	bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

	const helmetGeometry = new THREE.SphereGeometry(0.42, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.68);
	const helmetMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.35 });
	const helmets = new THREE.InstancedMesh(helmetGeometry, helmetMaterial, UNIT_COUNT);
	helmets.name = 'rts-soldier-helmets';
	helmets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

	const spearGeometry = new THREE.BoxGeometry(0.07, 2.7, 0.07);
	const spearMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
	const spears = new THREE.InstancedMesh(spearGeometry, spearMaterial, UNIT_COUNT);
	spears.name = 'rts-soldier-spears';
	spears.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

	const ringGeometry = new THREE.RingGeometry(0.72, 0.93, 18);
	ringGeometry.rotateX(-Math.PI * 0.5);
	const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xf6c44b, transparent: true, opacity: 0.92, depthWrite: false });
	const selectionRings = new THREE.InstancedMesh(ringGeometry, ringMaterial, UNIT_COUNT);
	selectionRings.name = 'rts-selection-rings';
	selectionRings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

	group.add(bodies, helmets, spears, selectionRings);
	scene.add(group);

	for (let index = 0; index < UNIT_COUNT; index += 1) {
		const offset = formationOffset(index, UNIT_COUNT);
		const jitterX = (random() - 0.5) * 0.5;
		const jitterZ = (random() - 0.5) * 0.5;
		const x = center.x + 82 + offset.x + jitterX;
		const z = center.z + 28 + offset.z + jitterZ;
		const y = groundCollider.getGroundHeight(x, z);
		units.push({
			id: `soldier-${String(index + 1).padStart(2, '0')}`,
			position: new THREE.Vector3(x, y, z),
			destination: new THREE.Vector3(x, y, z),
			yaw: Math.PI,
			selected: false,
		});
		bodies.setColorAt(index, BODY_COLOR);
		helmets.setColorAt(index, HELMET_COLOR);
		spears.setColorAt(index, SPEAR_COLOR);
	}

	function syncInstance(index) {
		const unit = units[index];
		setMatrix(bodies, index, unit.position, 0.88, new THREE.Vector3(1, 1, 1), unit.yaw);
		setMatrix(helmets, index, unit.position, 1.8, new THREE.Vector3(1, 1, 1), unit.yaw);
		setMatrix(spears, index, unit.position, 1.35, new THREE.Vector3(1, 1, 1), unit.yaw, 0.64, 0.06);
		setMatrix(
			selectionRings,
			index,
			unit.position,
			0.035,
			unit.selected ? new THREE.Vector3(1, 1, 1) : new THREE.Vector3(0.0001, 0.0001, 0.0001),
			0,
		);
		bodies.setColorAt(index, unit.selected ? SELECTED_COLOR : BODY_COLOR);
		helmets.setColorAt(index, unit.selected ? SELECTED_COLOR : HELMET_COLOR);
	}

	function flushInstances() {
		for (let index = 0; index < units.length; index += 1) syncInstance(index);
		bodies.instanceMatrix.needsUpdate = true;
		helmets.instanceMatrix.needsUpdate = true;
		spears.instanceMatrix.needsUpdate = true;
		selectionRings.instanceMatrix.needsUpdate = true;
		if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
		if (helmets.instanceColor) helmets.instanceColor.needsUpdate = true;
	}

	function clearSelection() {
		for (const unit of units) unit.selected = false;
		flushInstances();
	}

	function setSelection(indices, additive = false) {
		if (!additive) {
			for (const unit of units) unit.selected = false;
		}
		for (const index of indices) {
			if (index >= 0 && index < units.length) units[index].selected = true;
		}
		flushInstances();
	}

	function selectAll() {
		for (const unit of units) unit.selected = true;
		flushInstances();
	}

	function pick(raycaster, additive = false) {
		const hits = raycaster.intersectObject(bodies, false);
		if (hits.length === 0 || hits[0].instanceId == null) {
			if (!additive) clearSelection();
			return null;
		}
		const index = hits[0].instanceId;
		if (additive) units[index].selected = !units[index].selected;
		else {
			for (const unit of units) unit.selected = false;
			units[index].selected = true;
		}
		flushInstances();
		return index;
	}

	function selectInScreenRect(camera, viewportRect, start, end, additive = false) {
		const minX = Math.min(start.x, end.x);
		const maxX = Math.max(start.x, end.x);
		const minY = Math.min(start.y, end.y);
		const maxY = Math.max(start.y, end.y);
		const indices = [];
		for (let index = 0; index < units.length; index += 1) {
			const projected = units[index].position.clone().project(camera);
			if (projected.z < -1 || projected.z > 1) continue;
			const screenX = viewportRect.left + (projected.x * 0.5 + 0.5) * viewportRect.width;
			const screenY = viewportRect.top + (-projected.y * 0.5 + 0.5) * viewportRect.height;
			if (screenX >= minX && screenX <= maxX && screenY >= minY && screenY <= maxY) indices.push(index);
		}
		setSelection(indices, additive);
		return indices.length;
	}

	function commandMove(target) {
		const selectedIndices = [];
		for (let index = 0; index < units.length; index += 1) if (units[index].selected) selectedIndices.push(index);
		for (let selectionIndex = 0; selectionIndex < selectedIndices.length; selectionIndex += 1) {
			const unitIndex = selectedIndices[selectionIndex];
			const offset = formationOffset(selectionIndex, selectedIndices.length);
			const destinationX = target.x + offset.x;
			const destinationZ = target.z + offset.z;
			units[unitIndex].destination.set(
				destinationX,
				groundCollider.getGroundHeight(destinationX, destinationZ),
				destinationZ,
			);
		}
		return selectedIndices.length;
	}

	function update(delta) {
		const step = Math.max(0, delta) * MOVE_SPEED_MPS;
		for (const unit of units) {
			const dx = unit.destination.x - unit.position.x;
			const dz = unit.destination.z - unit.position.z;
			const distance = Math.hypot(dx, dz);
			if (distance > ARRIVAL_EPSILON_METERS) {
				const move = Math.min(step, distance);
				const nx = dx / distance;
				const nz = dz / distance;
				unit.position.x += nx * move;
				unit.position.z += nz * move;
				unit.position.y = groundCollider.getGroundHeight(unit.position.x, unit.position.z);
				unit.yaw = Math.atan2(nx, nz);
			} else {
				unit.position.copy(unit.destination);
			}
		}
		flushInstances();
	}

	function getSelectionCount() {
		let count = 0;
		for (const unit of units) if (unit.selected) count += 1;
		return count;
	}

	function getCenterOfSelection() {
		const selected = units.filter((unit) => unit.selected);
		const source = selected.length > 0 ? selected : units;
		const centerPoint = new THREE.Vector3();
		for (const unit of source) centerPoint.add(unit.position);
		return centerPoint.multiplyScalar(1 / Math.max(1, source.length));
	}

	function dispose() {
		scene.remove(group);
		disposeInstancedMesh(bodies);
		disposeInstancedMesh(helmets);
		disposeInstancedMesh(spears);
		disposeInstancedMesh(selectionRings);
	}

	flushInstances();

	return {
		group,
		pick,
		selectAll,
		clearSelection,
		selectInScreenRect,
		commandMove,
		update,
		getSelectionCount,
		getUnitCount: () => units.length,
		getCenterOfSelection,
		dispose,
	};
}
