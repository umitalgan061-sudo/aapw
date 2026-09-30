import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';
import { WORLD_DEFAULTS, SETTLEMENT_CONFIG, CHUNK_CONFIG, EVENTS } from '../config.js';
import { ANIMAL_CONFIG, DRAGON_CONFIG } from '../gameplay/gameplayConfig.js';
import { createScene, isCoarsePointerDevice, worldToChunkCoord } from '../sceneManager.js';
import { gameEvents } from '../eventBus.js';
import { spawnConfiguredAnimals } from '../gameplay/animals.js';
import { spawnConfiguredDragons } from '../gameplay/dragons.js';
import { spawnRealCastleModels, disposeSettlements, disposeRealCastleModels } from '../world/settlements.js';
import { disposeRoadNetwork } from '../world/roads.js';
import { disposeVegetation } from '../world/vegetation.js';
import { updateWater, disposeWater } from '../world/water.js';
import { disposeRiverMesh, disposeWaterfallMesh, updateFlowAnimation } from '../world/rivers.js';
import { updateAuroraSky, disposeAuroraSky } from '../sky.js';
import { updateStarfield, disposeStarfield } from '../stars.js';
import { updateDayNightLighting, disposeDayNightLighting } from '../lighting.js';
import { updateFog } from '../fog.js';
import { createRtsArmy } from './rtsArmy.js';

const CAMERA_MIN_DISTANCE = 135;
const CAMERA_MAX_DISTANCE = 1450;
const CAMERA_PAN_FACTOR = 0.62;
const SELECTION_DRAG_THRESHOLD_PX = 7;
const RTS_SEED_TAG = 0x52545331;

function pointerToNdc(event, canvas) {
	const rect = canvas.getBoundingClientRect();
	return new THREE.Vector2(
		((event.clientX - rect.left) / rect.width) * 2 - 1,
		-((event.clientY - rect.top) / rect.height) * 2 + 1,
	);
}

function setSelectionBox(box, start, end, visible) {
	if (!box) return;
	box.hidden = !visible;
	if (!visible) return;
	box.style.left = `${Math.min(start.x, end.x)}px`;
	box.style.top = `${Math.min(start.y, end.y)}px`;
	box.style.width = `${Math.abs(end.x - start.x)}px`;
	box.style.height = `${Math.abs(end.y - start.y)}px`;
}

function createResizeBinding(state) {
	const onResize = () => {
		const width = window.innerWidth;
		const height = window.innerHeight;
		state.camera.aspect = width / Math.max(1, height);
		state.camera.updateProjectionMatrix();
		state.renderer.setSize(width, height);
	};
	window.addEventListener('resize', onResize);
	return () => window.removeEventListener('resize', onResize);
}

function projectRayToCommandPlane(raycaster, camera, ndc, planeY) {
	raycaster.setFromCamera(ndc, camera);
	const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
	const point = new THREE.Vector3();
	return raycaster.ray.intersectPlane(plane, point) ? point : null;
}

/**
 * High-level RTS surface. It intentionally does not create a playable avatar: the camera owns the
 * viewpoint and the army is commanded as a group, Age-of-Empires style.
 */
export async function initRtsGame() {
	const canvas = document.getElementById('rts-canvas');
	if (!canvas) throw new Error('RTS canvas not found.');

	const loading = document.getElementById('rts-loading');
	const status = document.getElementById('rts-status');
	const selectionBox = document.getElementById('rts-selection-box');
	const selectionCount = document.getElementById('rts-selection-count');
	const selectAllButton = document.getElementById('rts-select-all');
	const moveButton = document.getElementById('rts-move-command');
	const focusButton = document.getElementById('rts-focus-army');

	const state = createScene(canvas);
	const assetLoader = new AssetLoader({ events: gameEvents });
	const unbindResize = createResizeBinding(state);
	const seatsById = new Map(state.settlementSeats.map((seat) => [seat.id, seat]));
	const centerSeat = seatsById.get('umit') ?? state.settlementSeats[0];
	if (!centerSeat) throw new Error('No settlement seat is available for RTS deployment.');

	const centerChunkX = worldToChunkCoord(centerSeat.x, CHUNK_CONFIG.CHUNK_SIZE_METERS);
	const centerChunkZ = worldToChunkCoord(centerSeat.z, CHUNK_CONFIG.CHUNK_SIZE_METERS);
	state.chunkManager.loadSquare(centerChunkX, centerChunkZ, isCoarsePointerDevice() ? 1 : 2);

	state.controls.enableRotate = false;
	state.controls.enablePan = false;
	state.controls.enableZoom = true;
	state.controls.minDistance = CAMERA_MIN_DISTANCE;
	state.controls.maxDistance = CAMERA_MAX_DISTANCE;
	state.controls.target.set(centerSeat.x + 55, centerSeat.groundY, centerSeat.z + 20);
	state.camera.position.set(centerSeat.x + 360, centerSeat.groundY + 520, centerSeat.z + 460);
	state.controls.update();

	const army = createRtsArmy({
		scene: state.scene,
		groundCollider: state.groundCollider,
		center: centerSeat,
		seed: WORLD_DEFAULTS.WORLD_SEED ^ RTS_SEED_TAG,
	});
	army.selectAll();

	const sampleClampedGroundY = (worldX, worldZ) => Math.max(
		state.groundCollider.getGroundHeight(worldX, worldZ),
		WORLD_DEFAULTS.WATER_LEVEL_METERS + SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
	);

	state.realCastles = await spawnRealCastleModels({
		assetLoader,
		seats: state.settlementSeats,
		seed: WORLD_DEFAULTS.WORLD_SEED,
	});
	state.scene.add(state.realCastles);

	const ambientResults = await Promise.allSettled([
		spawnConfiguredAnimals({
			assetLoader,
			animalConfig: ANIMAL_CONFIG,
			seatsById,
			sampleGroundY: sampleClampedGroundY,
			groundCollider: state.groundCollider,
		}),
		spawnConfiguredDragons({
			assetLoader,
			dragonConfig: DRAGON_CONFIG,
			seatsById,
			sampleGroundY: sampleClampedGroundY,
			eventsBus: gameEvents,
			eventName: EVENTS.WORLD_EVENT_TRIGGERED,
			biteEventName: EVENTS.PLAYER_DAMAGED,
		}),
	]);
	state.animals = ambientResults[0].status === 'fulfilled' ? ambientResults[0].value : [];
	state.dragons = ambientResults[1].status === 'fulfilled' ? ambientResults[1].value : [];
	for (const animal of state.animals) state.scene.add(animal.object3D);
	for (const dragon of state.dragons) state.scene.add(dragon.object3D);

	const raycaster = new THREE.Raycaster();
	const keysDown = new Set();
	let moveMode = false;
	let pointerStart = null;
	let pointerCurrent = null;
	let pointerDragged = false;
	let frameId = 0;
	let disposed = false;
	let elapsedSeconds = 0;
	let previousTime = performance.now();

	function refreshHud(message) {
		const selected = army.getSelectionCount();
		if (selectionCount) selectionCount.textContent = `${selected} / ${army.getUnitCount()} asker seçili`;
		if (status) status.textContent = message || (moveMode ? 'Hareket emri: hedef noktaya dokun/tıkla.' : 'Sol tık/sürükle: seç • Sağ tık: hareket • WASD: kamera');
		if (moveButton) moveButton.classList.toggle('is-active', moveMode);
	}

	function issueMoveAt(event) {
		const ndc = pointerToNdc(event, canvas);
		const target = projectRayToCommandPlane(raycaster, state.camera, ndc, centerSeat.groundY);
		if (!target) return false;
		const commanded = army.commandMove(target);
		moveMode = false;
		refreshHud(commanded > 0 ? `${commanded} asker hedefe ilerliyor.` : 'Önce asker seç.');
		return commanded > 0;
	}

	function focusArmy() {
		const center = army.getCenterOfSelection();
		const deltaX = center.x - state.controls.target.x;
		const deltaZ = center.z - state.controls.target.z;
		state.controls.target.x += deltaX;
		state.controls.target.z += deltaZ;
		state.camera.position.x += deltaX;
		state.camera.position.z += deltaZ;
		state.controls.update();
	}

	function onPointerDown(event) {
		if (event.button !== 0) return;
		pointerStart = { x: event.clientX, y: event.clientY };
		pointerCurrent = { ...pointerStart };
		pointerDragged = false;
		canvas.setPointerCapture?.(event.pointerId);
	}

	function onPointerMove(event) {
		if (!pointerStart) return;
		pointerCurrent = { x: event.clientX, y: event.clientY };
		pointerDragged = Math.hypot(pointerCurrent.x - pointerStart.x, pointerCurrent.y - pointerStart.y) >= SELECTION_DRAG_THRESHOLD_PX;
		setSelectionBox(selectionBox, pointerStart, pointerCurrent, pointerDragged && !moveMode);
	}

	function onPointerUp(event) {
		if (event.button !== 0 || !pointerStart) return;
		canvas.releasePointerCapture?.(event.pointerId);
		if (moveMode && !pointerDragged) {
			issueMoveAt(event);
		} else if (pointerDragged) {
			army.selectInScreenRect(state.camera, canvas.getBoundingClientRect(), pointerStart, pointerCurrent, event.shiftKey);
			refreshHud();
		} else {
			raycaster.setFromCamera(pointerToNdc(event, canvas), state.camera);
			army.pick(raycaster, event.shiftKey);
			refreshHud();
		}
		setSelectionBox(selectionBox, pointerStart, pointerCurrent, false);
		pointerStart = null;
		pointerCurrent = null;
		pointerDragged = false;
	}

	function onContextMenu(event) {
		event.preventDefault();
		issueMoveAt(event);
	}

	function onKeyDown(event) {
		keysDown.add(event.code);
		if (event.code === 'Escape') {
			moveMode = false;
			army.clearSelection();
			refreshHud();
		}
		if ((event.ctrlKey || event.metaKey) && event.code === 'KeyA') {
			event.preventDefault();
			army.selectAll();
			refreshHud('Tüm ordu seçildi.');
		}
	}

	function onKeyUp(event) {
		keysDown.delete(event.code);
	}

	function panCamera(delta) {
		let horizontal = 0;
		let vertical = 0;
		if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) horizontal -= 1;
		if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) horizontal += 1;
		if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) vertical += 1;
		if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) vertical -= 1;
		if (horizontal === 0 && vertical === 0) return;

		const forward = state.controls.target.clone().sub(state.camera.position);
		forward.y = 0;
		if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
		forward.normalize();
		const right = new THREE.Vector3(-forward.z, 0, forward.x);
		const direction = forward.multiplyScalar(vertical).add(right.multiplyScalar(horizontal));
		if (direction.lengthSq() > 1) direction.normalize();
		const distance = state.camera.position.distanceTo(state.controls.target);
		const amount = Math.max(60, distance * CAMERA_PAN_FACTOR) * delta;
		direction.multiplyScalar(amount);
		state.controls.target.add(direction);
		state.camera.position.add(direction);
	}

	selectAllButton?.addEventListener('click', () => {
		army.selectAll();
		refreshHud('Tüm ordu seçildi.');
	});
	moveButton?.addEventListener('click', () => {
		moveMode = !moveMode;
		refreshHud();
	});
	focusButton?.addEventListener('click', () => {
		focusArmy();
		refreshHud('Kamera seçili birliklere odaklandı.');
	});
	canvas.addEventListener('pointerdown', onPointerDown);
	canvas.addEventListener('pointermove', onPointerMove);
	canvas.addEventListener('pointerup', onPointerUp);
	canvas.addEventListener('contextmenu', onContextMenu);
	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);

	function tick(now) {
		if (disposed) return;
		const delta = Math.min(0.05, Math.max(0, (now - previousTime) / 1000));
		previousTime = now;
		elapsedSeconds += delta;
		panCamera(delta);
		army.update(delta);
		for (const animal of state.animals) animal.update(delta, { x: centerSeat.x + 50000, z: centerSeat.z + 50000 }, []);
		for (const dragon of state.dragons) dragon.update(delta, { x: centerSeat.x + 50000, z: centerSeat.z + 50000 });
		const dayNight = updateDayNightLighting(
			state.lights,
			elapsedSeconds,
			WORLD_DEFAULTS.DAY_LENGTH_SECONDS,
			WORLD_DEFAULTS.START_TIME_OF_DAY_RATIO,
		);
		updateAuroraSky(state.sky, state.camera.position, elapsedSeconds, dayNight);
		updateStarfield(state.stars, state.camera.position, elapsedSeconds, dayNight.nightFactor);
		updateFog(state.scene.fog, dayNight);
		updateWater(state.water, state.camera.position, elapsedSeconds);
		// Same downstream flow the third-person mode animates (ADR-0271) — the RTS camera looks
		// straight down at the river, so a frozen ribbon would read as painted-on here first.
		updateFlowAnimation(state.river, elapsedSeconds);
		for (const waterfall of state.waterfalls) updateFlowAnimation(waterfall, elapsedSeconds);
		state.controls.update();
		state.renderer.render(state.scene, state.camera);
		frameId = requestAnimationFrame(tick);
	}

	function dispose() {
		if (disposed) return;
		disposed = true;
		cancelAnimationFrame(frameId);
		unbindResize();
		canvas.removeEventListener('pointerdown', onPointerDown);
		canvas.removeEventListener('pointermove', onPointerMove);
		canvas.removeEventListener('pointerup', onPointerUp);
		canvas.removeEventListener('contextmenu', onContextMenu);
		window.removeEventListener('keydown', onKeyDown);
		window.removeEventListener('keyup', onKeyUp);
		army.dispose();
		for (const animal of state.animals) animal.dispose();
		for (const dragon of state.dragons) dragon.dispose();
		state.controls.dispose();
		state.freeCamera.dispose();
		state.chunkManager.disposeAll();
		disposeAuroraSky(state.sky);
		disposeStarfield(state.stars);
		disposeWater(state.water);
		if (state.river) disposeRiverMesh(state.river);
		state.waterfalls.forEach(disposeWaterfallMesh);
		disposeSettlements(state.settlements);
		disposeRealCastleModels(state.realCastles);
		disposeRoadNetwork(state.roads);
		disposeVegetation(state.vegetation);
		disposeDayNightLighting(state.scene, state.lights);
		state.renderer.dispose();
	}

	window.addEventListener('pagehide', dispose, { once: true });
	refreshHud('48 kişilik ordu hazır. Sol tık/sürükle ile seç, sağ tıkla hareket ettir.');
	if (loading) loading.classList.add('is-hidden');
	document.body.dataset.rtsReady = 'true';
	window.__WESTEROS_RTS__ = {
		getSnapshot: () => ({
			unitCount: army.getUnitCount(),
			selectedCount: army.getSelectionCount(),
			animalCount: state.animals.length,
			dragonCount: state.dragons.length,
			realCastleCount: state.realCastles?.children?.length ?? 0,
			drawCalls: state.renderer.info.render.calls,
			triangles: state.renderer.info.render.triangles,
			coarsePointer: isCoarsePointerDevice(),
		}),
		selectAll: () => army.selectAll(),
		focusArmy,
		dispose,
	};
	frameId = requestAnimationFrame(tick);
}
