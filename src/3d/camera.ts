/** Production TypeScript camera boundary: OrbitControls setup and collision-safe chase positioning. */
import * as THREE from 'three';
import { OrbitControls } from './vendor/three/addons/controls/OrbitControls.js';

export interface OrbitCameraOptions {
  readonly minDistance?: number;
  readonly maxDistance?: number;
}

export function createOrbitCamera(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
  { minDistance = 20, maxDistance = 1800 }: OrbitCameraOptions = {},
): OrbitControls {
  const controls = new OrbitControls(camera, domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = Math.max(0.1, minDistance);
  controls.maxDistance = Math.max(controls.minDistance, maxDistance);
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.update();
  return controls;
}

const rayDirection = new THREE.Vector3();

export function resolveCameraCollision(
  raycaster: THREE.Raycaster,
  target: THREE.Vector3,
  desiredPosition: THREE.Vector3,
  collidables: readonly THREE.Object3D[],
  marginMeters: number,
  minDistanceMeters: number,
): THREE.Vector3 {
  rayDirection.subVectors(desiredPosition, target);
  const desiredDistance = rayDirection.length();
  if (desiredDistance < 1e-6 || collidables.length === 0) return desiredPosition;
  rayDirection.divideScalar(desiredDistance);

  raycaster.set(target, rayDirection);
  raycaster.near = 0;
  raycaster.far = desiredDistance;
  const hits = raycaster.intersectObjects(collidables, false);
  const firstHit = hits[0];
  if (!firstHit) return desiredPosition;

  const clampedDistance = Math.max(minDistanceMeters, firstHit.distance - Math.max(0, marginMeters));
  return target.clone().addScaledVector(rayDirection, clampedDistance);
}
