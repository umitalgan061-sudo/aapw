
import { clamp, ok, type R35Result, type R35Vec3 } from './contracts';

export interface PhotoCamera {
  readonly position: R35Vec3;
  readonly target: R35Vec3;
  readonly fov: number;
  readonly roll: number;
  readonly aperture: number;
  readonly exposure: number;
  readonly focusDistance: number;
}

export interface PhotoState {
  readonly active: boolean;
  readonly camera: PhotoCamera;
  readonly hideUi: boolean;
  readonly depthOfField: boolean;
  readonly vignette: number;
  readonly grain: number;
}

export class PhotoModeRuntimeR35 {
  #state: PhotoState = Object.freeze({
    active: false,
    camera: Object.freeze({
      position: Object.freeze({ x: 0, y: 2, z: 5 }),
      target: Object.freeze({ x: 0, y: 1, z: 0 }),
      fov: 55,
      roll: 0,
      aperture: 2.8,
      exposure: 0,
      focusDistance: 5,
    }),
    hideUi: false,
    depthOfField: true,
    vignette: 0.1,
    grain: 0,
  });

  enter(camera: PhotoCamera): PhotoState {
    this.#state = Object.freeze({
      ...this.#state,
      active: true,
      camera: this.#normalize(camera),
    });
    return this.#state;
  }

  exit(): PhotoState {
    this.#state = Object.freeze({
      ...this.#state,
      active: false,
    });
    return this.#state;
  }

  update(
    changes: Partial<PhotoCamera>,
  ): R35Result<PhotoState> {
    if (!this.#state.active) {
      return {
        ok: false,
        error: {
          code: 'PHOTO_INACTIVE',
          message: 'Photo mode is not active',
          retryable: false,
        },
      };
    }

    this.#state = Object.freeze({
      ...this.#state,
      camera: this.#normalize({
        ...this.#state.camera,
        ...changes,
      }),
    });

    return ok(this.#state);
  }

  setEffects(
    effects: Partial<
      Pick<
        PhotoState,
        'hideUi' | 'depthOfField' | 'vignette' | 'grain'
      >
    >,
  ): PhotoState {
    this.#state = Object.freeze({
      ...this.#state,
      hideUi: effects.hideUi ?? this.#state.hideUi,
      depthOfField:
        effects.depthOfField
        ?? this.#state.depthOfField,
      vignette: clamp(
        effects.vignette ?? this.#state.vignette,
        0,
        1,
      ),
      grain: clamp(
        effects.grain ?? this.#state.grain,
        0,
        1,
      ),
    });

    return this.#state;
  }

  dolly(distance: number): R35Result<PhotoState> {
    const camera = this.#state.camera;
    const dx = camera.position.x - camera.target.x;
    const dy = camera.position.y - camera.target.y;
    const dz = camera.position.z - camera.target.z;
    const length = Math.hypot(dx, dy, dz) || 1;

    return this.update({
      position: {
        x: camera.position.x + (dx / length) * distance,
        y: camera.position.y + (dy / length) * distance,
        z: camera.position.z + (dz / length) * distance,
      },
    });
  }

  orbit(
    horizontal: number,
    vertical: number,
  ): R35Result<PhotoState> {
    const camera = this.#state.camera;
    const dx = camera.position.x - camera.target.x;
    const dy = camera.position.y - camera.target.y;
    const dz = camera.position.z - camera.target.z;
    const radius = Math.max(
      0.01,
      Math.hypot(dx, dy, dz),
    );
    const azimuth =
      Math.atan2(dz, dx) + horizontal;
    const elevation = clamp(
      Math.atan2(
        dy,
        Math.hypot(dx, dz),
      ) + vertical,
      -Math.PI * 0.49,
      Math.PI * 0.49,
    );

    return this.update({
      position: {
        x:
          camera.target.x
          + Math.cos(azimuth)
          * Math.cos(elevation)
          * radius,
        y:
          camera.target.y
          + Math.sin(elevation)
          * radius,
        z:
          camera.target.z
          + Math.sin(azimuth)
          * Math.cos(elevation)
          * radius,
      },
    });
  }

  state(): PhotoState {
    return this.#state;
  }

  #normalize(camera: PhotoCamera): PhotoCamera {
    return Object.freeze({
      ...camera,
      fov: clamp(camera.fov, 10, 120),
      roll: clamp(
        camera.roll,
        -Math.PI,
        Math.PI,
      ),
      aperture: clamp(
        camera.aperture,
        0.7,
        32,
      ),
      exposure: clamp(
        camera.exposure,
        -8,
        8,
      ),
      focusDistance: clamp(
        camera.focusDistance,
        0.1,
        10000,
      ),
      position: Object.freeze({
        ...camera.position,
      }),
      target: Object.freeze({
        ...camera.target,
      }),
    });
  }
}
