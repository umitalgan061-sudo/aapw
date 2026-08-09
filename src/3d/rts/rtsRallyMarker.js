import * as THREE from 'three';

const MARKER_RADIUS_METERS = 18;
const MARKER_TUBE_METERS = 2.2;
const MARKER_LIFETIME_SECONDS = 1.6;
const MARKER_BASE_OPACITY = 0.82;
const MARKER_Y_OFFSET_METERS = 0.45;

/**
 * Small world-space destination marker for successful RTS move commands.
 * Owns one mesh and never changes army, camera, terrain or command state.
 */
export function createRtsRallyMarker(scene) {
	if (!scene) throw new Error('RTS rally marker requires a scene.');

	const geometry = new THREE.RingGeometry(
		MARKER_RADIUS_METERS - MARKER_TUBE_METERS,
		MARKER_RADIUS_METERS,
		48,
	);
	const material = new THREE.MeshBasicMaterial({
		color: 0xe5c266,
		transparent: true,
		opacity: 0,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
	const marker = new THREE.Mesh(geometry, material);
	marker.name = 'rts-rally-marker';
	marker.rotation.x = -Math.PI / 2;
	marker.renderOrder = 24;
	marker.visible = false;
	marker.frustumCulled = false;
	scene.add(marker);

	let remainingSeconds = 0;
	let disposed = false;

	function show(worldX, groundY, worldZ, commandedCount = 0) {
		if (disposed || commandedCount <= 0) return false;
		marker.position.set(worldX, groundY + MARKER_Y_OFFSET_METERS, worldZ);
		marker.scale.setScalar(0.72);
		material.opacity = MARKER_BASE_OPACITY;
		remainingSeconds = MARKER_LIFETIME_SECONDS;
		marker.visible = true;
		return true;
	}

	function update(deltaSeconds) {
		if (disposed || !marker.visible) return;
		remainingSeconds = Math.max(0, remainingSeconds - Math.max(0, deltaSeconds));
		const progress = 1 - (remainingSeconds / MARKER_LIFETIME_SECONDS);
		const pulse = 1 + Math.sin(progress * Math.PI) * 0.28;
		marker.scale.setScalar(0.72 + progress * 0.58 + pulse * 0.08);
		material.opacity = MARKER_BASE_OPACITY * Math.max(0, 1 - progress * progress);
		if (remainingSeconds <= 0) {
			marker.visible = false;
			material.opacity = 0;
		}
	}

	function getSnapshot() {
		return {
			visible: marker.visible,
			remainingSeconds,
			position: { x: marker.position.x, y: marker.position.y, z: marker.position.z },
			opacity: material.opacity,
		};
	}

	function dispose() {
		if (disposed) return;
		disposed = true;
		scene.remove(marker);
		geometry.dispose();
		material.dispose();
	}

	return { show, update, getSnapshot, dispose };
}
