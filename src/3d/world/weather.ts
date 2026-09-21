/** Production TypeScript weather runtime. Deterministic raindrop layout; no independent scheduler. */
import * as THREE from 'three';
import { mulberry32 } from './terrain.ts';

export const RAIN_DROP_COUNT = 900;
const RAIN_RADIUS_METERS = 60;
const RAIN_FALL_HEIGHT_METERS = 40;
const RAIN_CEILING_OFFSET_METERS = 22;
const RAIN_DROP_LENGTH_METERS = 0.9;
const RAIN_FALL_SPEED_METERS_PER_SECOND = 24;
const INTENSITY_FADE_SECONDS = 4;

export interface WeatherSystem {
  readonly group: THREE.LineSegments;
  readonly update: (deltaSeconds: number, cameraPosition: THREE.Vector3) => void;
  readonly trigger: (durationSeconds: number) => void;
  readonly dispose: () => void;
}

export function createWeatherSystem({ seed }: { readonly seed: number }): WeatherSystem {
  const random = mulberry32(seed ^ 0x77454154);
  const positions = new Float32Array(RAIN_DROP_COUNT * 2 * 3);
  const offsetsX = new Float32Array(RAIN_DROP_COUNT);
  const offsetsZ = new Float32Array(RAIN_DROP_COUNT);
  const phases = new Float32Array(RAIN_DROP_COUNT);

  for (let index = 0; index < RAIN_DROP_COUNT; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * RAIN_RADIUS_METERS;
    offsetsX[index] = Math.cos(angle) * radius;
    offsetsZ[index] = Math.sin(angle) * radius;
    phases[index] = random() * RAIN_FALL_HEIGHT_METERS;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, RAIN_CEILING_OFFSET_METERS - RAIN_FALL_HEIGHT_METERS / 2, 0),
    RAIN_RADIUS_METERS + RAIN_FALL_HEIGHT_METERS,
  );

  const material = new THREE.LineBasicMaterial({
    color: 0xbccbe0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const group = new THREE.LineSegments(geometry, material);
  group.frustumCulled = true;
  group.renderOrder = 1;

  let intensity = 0;
  let remainingSeconds = 0;

  const writeDropPosition = (index: number, fallenY: number): void => {
    const base = index * 6;
    const x = offsetsX[index];
    const z = offsetsZ[index];
    const topY = RAIN_CEILING_OFFSET_METERS - fallenY;
    positions[base] = x;
    positions[base + 1] = topY;
    positions[base + 2] = z;
    positions[base + 3] = x;
    positions[base + 4] = topY - RAIN_DROP_LENGTH_METERS;
    positions[base + 5] = z;
  };

  for (let index = 0; index < RAIN_DROP_COUNT; index += 1) writeDropPosition(index, phases[index]);

  const trigger = (durationSeconds: number): void => {
    const safeDuration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
    remainingSeconds = Math.max(remainingSeconds, safeDuration + INTENSITY_FADE_SECONDS);
  };

  const update = (deltaSeconds: number, cameraPosition: THREE.Vector3): void => {
    const safeDelta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (remainingSeconds > 0) remainingSeconds = Math.max(0, remainingSeconds - safeDelta);

    const target = remainingSeconds > 0 ? 1 : 0;
    const fadeStep = safeDelta / INTENSITY_FADE_SECONDS;
    intensity = target > intensity
      ? Math.min(target, intensity + fadeStep)
      : Math.max(target, intensity - fadeStep);

    material.opacity = intensity * 0.55;
    group.visible = intensity > 0;
    if (!group.visible) return;

    group.position.copy(cameraPosition);
    const fallDistance = safeDelta * RAIN_FALL_SPEED_METERS_PER_SECOND;
    for (let index = 0; index < RAIN_DROP_COUNT; index += 1) {
      phases[index] = (phases[index] + fallDistance) % RAIN_FALL_HEIGHT_METERS;
      writeDropPosition(index, phases[index]);
    }
    geometry.attributes.position.needsUpdate = true;
  };

  const dispose = (): void => {
    geometry.dispose();
    material.dispose();
    intensity = 0;
    remainingSeconds = 0;
  };

  return Object.freeze({ group, update, trigger, dispose });
}
