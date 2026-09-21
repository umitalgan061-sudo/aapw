/** Production TypeScript render-quality policy and shadow orchestration. */
import * as THREE from './vendor/three/three.module.js';
import {
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  isQualityLevel,
  type QualityLevel,
  type QualityPreset,
} from './config.ts';

export type DesktopQualityLevel = Exclude<QualityLevel, 'automatic'>;

export interface RenderQuality {
  readonly level: DesktopQualityLevel;
  readonly preset: QualityPreset;
  readonly shadowsEnabled: boolean;
}

export interface RenderQualityOptions {
  readonly coarsePointer: boolean;
  readonly manualLevel?: string | null;
}

const TONE_MAPPING_EXPOSURE = 1.15;
const SHADOW_FRUSTUM_HALF_EXTENT_METERS = 120;
const SHADOW_CAMERA_NEAR_METERS = 1;
const SHADOW_CAMERA_FAR_METERS = 2400;
const SHADOW_BIAS = -0.0004;
const SHADOW_NORMAL_BIAS = 0.02;

export function resolveRenderQuality({
  coarsePointer,
  manualLevel = null,
}: RenderQualityOptions): RenderQuality {
  const manual = typeof manualLevel === 'string' && isQualityLevel(manualLevel)
    ? manualLevel
    : null;
  const overrideLevel: DesktopQualityLevel | null =
    !coarsePointer && manual && manual !== QUALITY_LEVELS.AUTOMATIC && QUALITY_PRESETS[manual as DesktopQualityLevel]
      ? manual as DesktopQualityLevel
      : null;
  const level: DesktopQualityLevel = overrideLevel
    ?? (coarsePointer ? QUALITY_LEVELS.LOW : QUALITY_LEVELS.HIGH);
  return Object.freeze({
    level,
    preset: QUALITY_PRESETS[level],
    shadowsEnabled: !coarsePointer,
  });
}

export function configureRendererRealism(renderer: THREE.WebGLRenderer, quality: RenderQuality): void {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
  renderer.shadowMap.enabled = quality.shadowsEnabled;
  if (quality.shadowsEnabled) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

export function configureSunShadow(sun: THREE.DirectionalLight, quality: RenderQuality): void {
  if (!quality.shadowsEnabled) {
    sun.castShadow = false;
    return;
  }
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.preset.shadowMapSize, quality.preset.shadowMapSize);
  const camera = sun.shadow.camera;
  camera.left = -SHADOW_FRUSTUM_HALF_EXTENT_METERS;
  camera.right = SHADOW_FRUSTUM_HALF_EXTENT_METERS;
  camera.top = SHADOW_FRUSTUM_HALF_EXTENT_METERS;
  camera.bottom = -SHADOW_FRUSTUM_HALF_EXTENT_METERS;
  camera.near = SHADOW_CAMERA_NEAR_METERS;
  camera.far = SHADOW_CAMERA_FAR_METERS;
  camera.updateProjectionMatrix();
  sun.shadow.bias = SHADOW_BIAS;
  sun.shadow.normalBias = SHADOW_NORMAL_BIAS;
}

export function focusSunShadow(sun: THREE.DirectionalLight, focusX: number, focusY: number, focusZ: number): void {
  if (!sun.castShadow) return;
  sun.position.x += focusX;
  sun.position.y += focusY;
  sun.position.z += focusZ;
  sun.target.position.set(focusX, focusY, focusZ);
  sun.target.updateMatrixWorld();
}

export function applyShadowRoles(
  root: THREE.Object3D | null | undefined,
  options: { readonly quality: RenderQuality; readonly cast?: boolean; readonly receive?: boolean },
): void {
  if (!root || !options.quality.shadowsEnabled) return;
  const cast = options.cast ?? true;
  const receive = options.receive ?? true;
  root.traverse((object) => {
    if (!(object.isMesh || object.isInstancedMesh || object.isSkinnedMesh)) return;
    object.castShadow = cast;
    object.receiveShadow = receive;
  });
}
