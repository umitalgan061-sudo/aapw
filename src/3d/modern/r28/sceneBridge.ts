import { RuntimeCameraController, type CameraTarget } from './cameraController.ts';
import { BrowserWorldBridge } from './worldBridge.ts';
import { TypedRendererBridge, type RendererHandle } from './rendererBridge.ts';
import { BrowserRuntimeHost } from './browserHost.ts';
import type { EntityId, VisibilityDecision } from '../r27/contracts.ts';
import type { WorldQueryEntity } from '../r27/worldQueries.ts';

export interface SceneBridgeConfig {
  readonly renderer: RendererHandle;
  readonly canvas: HTMLCanvasElement;
}

export class RuntimeSceneBridge {
  readonly host: BrowserRuntimeHost;
  readonly camera = new RuntimeCameraController();
  readonly world = new BrowserWorldBridge();
  readonly renderer: TypedRendererBridge;

  constructor(config: SceneBridgeConfig, host = new BrowserRuntimeHost({ canvas: config.canvas })) {
    this.host = host;
    this.renderer = new TypedRendererBridge({ renderer: config.renderer });
  }

  addEntity(entity: WorldQueryEntity): void {
    this.world.upsert(entity);
  }

  removeEntity(entity: EntityId): boolean {
    return this.world.remove(entity);
  }

  updateCamera(target: CameraTarget, deltaSeconds: number): void {
    this.camera.update(target, deltaSeconds);
  }

  render(): ReturnType<TypedRendererBridge['render']> {
    const snapshot = this.host.runtime.createSnapshot();
    const volume = this.camera.volume(Math.PI / 3, 16 / 9);
    const decisions: readonly VisibilityDecision[] = this.world.frame(
      volume,
      snapshot.qualityLevel,
      this.camera.state().target,
    ).visible;
    return this.renderer.render(snapshot, decisions);
  }

  resize(width: number, height: number, dpr = 1): void {
    this.renderer.resize(width, height, dpr);
  }

  dispose(): void {
    this.renderer.dispose();
    this.host.dispose();
  }
}
