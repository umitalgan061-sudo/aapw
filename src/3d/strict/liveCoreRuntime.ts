import {
  StrictAssetRuntime,
  DEFAULT_ASSET_POLICY,
} from './assetRuntime.ts';
import {
  DEFAULT_CAMERA_LIMITS,
  DEFAULT_CAMERA_POLICY,
  StrictCameraRuntime,
} from './cameraRuntime.ts';
import {
  DEFAULT_INPUT_POLICY,
  StrictInputRuntime,
} from './inputRuntime.ts';
import {
  DEFAULT_PHYSICS_POLICY,
  StrictPhysicsRuntime,
} from './physicsRuntime.ts';
import {
  DEFAULT_SCENE_POLICY,
  StrictSceneRuntime,
} from './sceneRuntime.ts';
import {
  StrictRenderBackendRuntime,
  buildStrictRenderPolicy,
} from './renderBackendRuntime.ts';
import {
  clamp,
  err,
  frameId,
  ok,
  stableHash,
  tickId,
  vec3,
} from './liveCoreTypes.ts';
import type {
  AssetRequest,
  CameraTarget,
  InputFrame,
  PhysicsBodyState,
  RenderCapabilities,
  RendererBackend,
  RenderPolicy,
  RawInputSample,
  RuntimeBudgets,
  RuntimeDiagnostics,
  RuntimePhase,
  RuntimeSnapshot,
  Result,
  SceneViewport,
  Vec3,
  JumpState,
} from './liveCoreTypes.ts';
import type { GroundSampler } from './physicsRuntime.ts';
import type { RendererPreference } from './renderBackendRuntime.ts';

export interface StrictLiveCoreOptions {
  readonly viewport?: SceneViewport;
  readonly capabilities?: RenderCapabilities;
  readonly rendererPreference?: RendererPreference;
  readonly groundSampler: GroundSampler;
  readonly player?: Partial<PhysicsBodyState>;
  readonly jump?: Partial<JumpState>;
  readonly initialCameraTarget?: Partial<CameraTarget>;
}

export interface RuntimeTickInput {
  readonly deltaSeconds: number;
  readonly timestampSeconds: number;
  readonly budgetHintMs?: Partial<RuntimeBudgets>;
  readonly cameraTarget?: CameraTarget;
  readonly collisionCandidates?: Parameters<StrictCameraRuntime['update']>[2];
  readonly movement?: Vec3;
  readonly jumpRequested?: boolean;
}

export interface RuntimeTickOutput {
  readonly frame: ReturnType<StrictSceneRuntime['frame']>;
  readonly input: InputFrame | null;
  readonly physics: ReturnType<StrictPhysicsRuntime['step']>;
  readonly camera: ReturnType<StrictCameraRuntime['update']>;
  readonly renderPolicy: RenderPolicy;
  readonly diagnostics: RuntimeDiagnostics;
};

export interface RuntimeCommand {
  readonly type: 'input' | 'asset' | 'pause' | 'resume' | 'resize' | 'renderer-preference' | 'device-lost';
  readonly sequence: number;
  readonly payload: unknown;
}

const DEFAULT_VIEWPORT: SceneViewport = Object.freeze({ width: 1280, height: 720, pixelRatio: 1 });

const DEFAULT_CAPABILITIES: RenderCapabilities = Object.freeze({
  secureContext: true,
  webgpu: false,
  webgl2: true,
  offscreenCanvas: true,
  hardwareConcurrency: 8,
  memoryGiB: 8,
  devicePixelRatio: 1,
});

const DEFAULT_RENDERER_PREFERENCE: RendererPreference = Object.freeze({
  backend: 'auto',
  quality: 'auto',
});

const createDefaultBody = (): PhysicsBodyState => Object.freeze({
  entity: 'player' as PhysicsBodyState['entity'],
  position: vec3(0, 0, 8),
  velocity: vec3(),
  radius: 0.42,
  height: 1.8,
  onGround: true,
  groundedMaterial: 'default-ground',
});

const createDefaultJump = (): JumpState => Object.freeze({
  heightAboveGround: 0,
  verticalVelocity: 0,
  grounded: true,
  coyoteRemaining: DEFAULT_PHYSICS_POLICY.coyoteTimeSeconds,
});

const createDefaultCameraTarget = (): CameraTarget => Object.freeze({
  position: vec3(0, 1, 8),
  lookAt: vec3(0, 1.4, 8),
  yaw: 0,
  pitch: 0.45,
});

export class StrictLiveCoreRuntime {
  readonly input: StrictInputRuntime;
  readonly assets: StrictAssetRuntime;
  readonly physics: StrictPhysicsRuntime;
  readonly camera: StrictCameraRuntime;
  readonly renderer: StrictRenderBackendRuntime;
  readonly scene: StrictSceneRuntime;

  #phase: RuntimePhase = 'created';
  #accumulator = 0;
  #simulatedSeconds = 0;
  #lastTimestampSeconds = 0;
  #commandSequence = 0;
  #commands: RuntimeCommand[] = [];
  #snapshotHistory: RuntimeSnapshot[] = [];
  #body: PhysicsBodyState;
  #jump: JumpState;
  #cameraTarget: CameraTarget;
  #disposed = false;
  #simulationSteps = 0;
  #collisionsResolved = 0;
  #lastInput: InputFrame | null = null;
  #lastCamera: ReturnType<StrictCameraRuntime['update']> | null = null;
  #lastPhysics: ReturnType<StrictPhysicsRuntime['step']> | null = null;
  #droppedCommands = 0;

  constructor(options: StrictLiveCoreOptions) {
    const viewport = options.viewport ?? DEFAULT_VIEWPORT;
    const capabilities = options.capabilities ?? DEFAULT_CAPABILITIES;
    const rendererPreference = options.rendererPreference ?? DEFAULT_RENDERER_PREFERENCE;
    const policy = buildStrictRenderPolicy(capabilities, rendererPreference);

    this.input = new StrictInputRuntime(DEFAULT_INPUT_POLICY);
    this.assets = new StrictAssetRuntime(DEFAULT_ASSET_POLICY);
    this.physics = new StrictPhysicsRuntime(options.groundSampler, DEFAULT_PHYSICS_POLICY);
    const initialCameraTarget: CameraTarget = Object.freeze({
      position: options.initialCameraTarget?.position ?? createDefaultCameraTarget().position,
      lookAt: options.initialCameraTarget?.lookAt ?? createDefaultCameraTarget().lookAt,
      yaw: options.initialCameraTarget?.yaw ?? createDefaultCameraTarget().yaw,
      pitch: options.initialCameraTarget?.pitch ?? createDefaultCameraTarget().pitch,
    });
    this.camera = new StrictCameraRuntime(
      initialCameraTarget,
      DEFAULT_CAMERA_LIMITS,
      DEFAULT_CAMERA_POLICY,
    );
    this.renderer = new StrictRenderBackendRuntime(capabilities, rendererPreference);
    this.scene = new StrictSceneRuntime(viewport, policy, DEFAULT_SCENE_POLICY);

    this.#body = Object.freeze({ ...createDefaultBody(), ...(options.player ?? {}) });
    this.#jump = Object.freeze({ ...createDefaultJump(), ...(options.jump ?? {}) });
    this.#cameraTarget = initialCameraTarget;
  }

  initialize(): Result<RuntimePhase> {
    if (this.#disposed) return err('RUNTIME_DISPOSED', 'Live core runtime is disposed.');
    if (this.#phase !== 'created' && this.#phase !== 'failed') {
      return ok(this.#phase);
    }
    const initializing = this.scene.transition('initializing', 'runtime-initialize');
    if (!initializing.ok) return initializing;
    const ready = this.scene.transition('ready', 'runtime-ready');
    if (!ready.ok) return ready;
    this.#phase = 'ready';
    return ok(this.#phase);
  }

  start(): Result<RuntimePhase> {
    if (this.#disposed) return err('RUNTIME_DISPOSED', 'Live core runtime is disposed.');
    if (this.#phase === 'created' || this.#phase === 'failed') {
      const init = this.initialize();
      if (!init.ok) return init;
    }
    if (this.#phase === 'ready' || this.#phase === 'paused') {
      const transition = this.scene.transition('running', 'runtime-start');
      if (!transition.ok) return transition;
      this.#phase = 'running';
    }
    return ok(this.#phase);
  }

  pause(reason = 'manual-pause'): Result<RuntimePhase> {
    if (this.#phase !== 'running') return ok(this.#phase);
    const result = this.scene.transition('paused', reason);
    if (result.ok) this.#phase = 'paused';
    return result;
  }

  resume(reason = 'manual-resume'): Result<RuntimePhase> {
    if (this.#phase !== 'paused') return ok(this.#phase);
    const result = this.scene.transition('running', reason);
    if (result.ok) this.#phase = 'running';
    return result;
  }

  submitInput(sample: RawInputSample): Result<InputFrame> {
    if (this.#disposed) return err('RUNTIME_DISPOSED', 'Live core runtime is disposed.');
    const command: RuntimeCommand = Object.freeze({
      type: 'input',
      sequence: ++this.#commandSequence,
      payload: sample,
    });
    this.#commands.push(command);
    if (this.#commands.length > 1024) {
      this.#commands.shift();
      this.#droppedCommands += 1;
    }
    const result = this.input.submit(sample);
    if (result.ok) this.#lastInput = result.value;
    return result;
  }

  requestAsset(request: AssetRequest, nowTick: number): ReturnType<StrictAssetRuntime['admit']> {
    if (this.#disposed) return err('RUNTIME_DISPOSED', 'Live core runtime is disposed.');
    return this.assets.admit(request, tickId(nowTick));
  }

  resize(width: number, height: number, pixelRatio: number): Result<SceneViewport> {
    if (this.#disposed) return err('RUNTIME_DISPOSED', 'Live core runtime is disposed.');
    return this.scene.resize(width, height, pixelRatio);
  }

  requestRendererPreference(preference: RendererPreference): Result<RenderPolicy> {
    if (this.#disposed) return err('RUNTIME_DISPOSED', 'Live core runtime is disposed.');
    this.#commands.push(Object.freeze({
      type: 'renderer-preference',
      sequence: ++this.#commandSequence,
      payload: preference,
    }));
    return ok(this.renderer.requestPreference(preference));
  }

  markDeviceLost(): Result<RenderPolicy> {
    if (this.#disposed) return err('RUNTIME_DISPOSED', 'Live core runtime is disposed.');
    this.#commands.push(Object.freeze({
      type: 'device-lost',
      sequence: ++this.#commandSequence,
      payload: null,
    }));
    return ok(this.renderer.markDeviceLost());
  }

  tick(input: RuntimeTickInput): Result<RuntimeTickOutput> {
    if (this.#disposed) return err('RUNTIME_DISPOSED', 'Live core runtime is disposed.');
    if (this.#phase !== 'running' && this.#phase !== 'paused') {
      return err('INVALID_FRAME', 'Runtime must be running or paused before ticking.', true, { phase: this.#phase });
    }

    const delta = clamp(input.deltaSeconds, 0, 0.25);
    const timestamp = Math.max(this.#lastTimestampSeconds, Number.isFinite(input.timestampSeconds) ? input.timestampSeconds : this.#lastTimestampSeconds);
    const effectiveDelta = this.#phase === 'paused' ? 0 : delta;
    this.#lastTimestampSeconds = timestamp;
    this.#accumulator += effectiveDelta;

    const inputStart = performanceNow();
    const activeInput = this.#lastInput;
    const movement = input.movement ?? movementFromInput(activeInput);
    const jumpRequested = Boolean(input.jumpRequested || activeInput?.intent.pressed.has('jump'));
    const fixedStep = DEFAULT_PHYSICS_POLICY.fixedStepSeconds;
    let steps = 0;

    while (this.#accumulator + 1e-9 >= fixedStep && steps < 5) {
      const physics = this.physics.step(this.#body, this.#jump, movement, jumpRequested, fixedStep);
      if (!physics.ok) return physics;
      this.#body = physics.value.body;
      this.#jump = physics.value.jump;
      this.#lastPhysics = physics;
      this.#accumulator -= fixedStep;
      this.#simulatedSeconds += fixedStep;
      this.#simulationSteps += 1;
      this.#collisionsResolved = physics.value.resolvedCollisions;
      steps += 1;
    }
    if (steps === 5 && this.#accumulator >= fixedStep) this.#accumulator = fixedStep * 0.999;

    const cameraTarget = input.cameraTarget ?? this.#cameraTarget;
    this.#cameraTarget = Object.freeze(cameraTarget);
    const camera = this.camera.update(
      effectiveDelta,
      cameraTarget,
      input.collisionCandidates ?? [],
    );
    this.#lastCamera = camera;
    if (!camera.ok) return camera;

    const inputMs = performanceNow() - inputStart;
    const renderMs = estimateRuntimeRenderMs(this.renderer.policy(), this.#body);
    const budgets: RuntimeBudgets = Object.freeze({
      simulationMs: steps * 0.16 + this.#collisionsResolved * 0.01,
      renderMs,
      inputMs: Math.max(0, inputMs),
      assetMs: 0,
      telemetryMs: 0.03,
      ...(input.budgetHintMs ?? {}),
    });

    const frameResult = this.scene.frame(effectiveDelta, budgets, this.#simulatedSeconds);
    if (!frameResult.ok) return frameResult;

    this.assets.tick(frameResult.value.tick);
    const diagnostics = this.#diagnostics(frameResult.value.id, frameResult.value.tick, renderMs);

    const snapshot = this.snapshot(frameResult.value.id, frameResult.value.tick);
    if (snapshot.ok) this.#recordSnapshot(snapshot.value);

    return ok(Object.freeze({
      frame: frameResult,
      input: activeInput,
      physics: this.#lastPhysics ?? this.physics.step(this.#body, this.#jump, movement, false, 0),
      camera,
      renderPolicy: this.renderer.policy(),
      diagnostics,
    }));
  }

  snapshot(frame = frameId(0), tick = tickId(this.#simulationSteps)): Result<RuntimeSnapshot> {
    if (this.#disposed) return err('RUNTIME_DISPOSED', 'Live core runtime is disposed.');
    const player = this.#body;
    const cameraResult = this.camera.snapshot();
    const digest = stableHash({
      tick,
      frame,
      phase: this.#phase,
      player: player.position,
      velocity: player.velocity,
      jump: this.#jump,
      camera: cameraResult,
    });
    return ok(Object.freeze({
      tick,
      frame,
      phase: this.#phase,
      player,
      camera: cameraResult,
      jump: this.#jump,
      digest,
    }));
  }

  restore(snapshot: RuntimeSnapshot): Result<void> {
    if (this.#disposed) return err('RUNTIME_DISPOSED', 'Live core runtime is disposed.');
    if (!snapshot?.digest || !snapshot.player || !snapshot.camera) {
      return err('INVALID_FRAME', 'Snapshot is incomplete.', true);
    }
    const recomputed = stableHash({
      tick: snapshot.tick,
      frame: snapshot.frame,
      phase: snapshot.phase,
      player: snapshot.player.position,
      velocity: snapshot.player.velocity,
      jump: snapshot.jump,
      camera: snapshot.camera,
    });
    if (recomputed !== snapshot.digest) {
      return err('INVALID_FRAME', 'Snapshot digest mismatch.', true);
    }
    this.#body = Object.freeze({ ...snapshot.player });
    this.#jump = Object.freeze({ ...snapshot.jump });
    this.#phase = snapshot.phase;
    this.#cameraTarget = Object.freeze({
      position: snapshot.camera.lookAt,
      lookAt: snapshot.camera.lookAt,
      yaw: 0,
      pitch: 0.45,
    });
    this.#simulationSteps = Math.max(0, Math.floor(Number(snapshot.tick)));
    this.#simulatedSeconds = this.#simulationSteps * DEFAULT_PHYSICS_POLICY.fixedStepSeconds;
    this.#accumulator = 0;
    this.#lastInput = null;
    return ok(undefined);
  }

  diagnostics(): RuntimeDiagnostics {
    return this.#diagnostics(frameId(this.#simulationSteps), tickId(this.#simulationSteps), 0);
  }

  transitions(): readonly { readonly from: RuntimePhase; readonly to: RuntimePhase; readonly reason: string; readonly tick: number }[] {
    return this.scene.diagnostics().transitions;
  }

  history(): readonly RuntimeSnapshot[] {
    return Object.freeze([...this.#snapshotHistory]);
  }

  commandJournal(): readonly RuntimeCommand[] {
    return Object.freeze([...this.#commands]);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#phase = 'stopping';
    this.scene.transition('stopping', 'runtime-dispose');
    this.input.dispose();
    this.assets.dispose();
    this.physics.dispose();
    this.camera.dispose();
    this.renderer.dispose();
    this.scene.dispose();
    this.#commands = [];
    this.#snapshotHistory = [];
    this.#disposed = true;
    this.#phase = 'disposed';
  }

  #recordSnapshot(snapshot: RuntimeSnapshot): void {
    this.#snapshotHistory.push(snapshot);
    if (this.#snapshotHistory.length > 120) this.#snapshotHistory.shift();
  }

  #diagnostics(frame: ReturnType<typeof frameId>, tick: ReturnType<typeof tickId>, renderMs: number): RuntimeDiagnostics {
    const assetDiagnostics = this.assets.diagnostics();
    const inputDiagnostics = this.input.diagnostics();
    return Object.freeze({
      frame,
      tick,
      phase: this.#phase,
      backend: this.renderer.policy().backend,
      quality: this.renderer.policy().tier,
      activeAssets: assetDiagnostics.resident + assetDiagnostics.loading,
      residentAssetBytes: assetDiagnostics.residentBytes,
      droppedInputSamples: inputDiagnostics.droppedSamples + this.#droppedCommands,
      collisionsResolved: this.#collisionsResolved,
      simulationSteps: this.#simulationSteps,
      frameTimeMs: renderMs,
      digest: stableHash({
        frame, tick, phase: this.#phase, backend: this.renderer.policy().backend,
        quality: this.renderer.policy().tier, body: this.#body, jump: this.#jump,
      }),
    });
  }
}

const movementFromInput = (input: InputFrame | null): Vec3 => {
  if (!input) return vec3();
  return vec3(input.intent.move.x, 0, input.intent.move.y);
};

const estimateRuntimeRenderMs = (policy: RenderPolicy, body: PhysicsBodyState): number => {
  const base = policy.backend === 'webgpu' ? 3.2 : policy.backend === 'webgl2' ? 4.5 : 1;
  const qualityMultiplier = policy.tier === 'ultra' ? 1.5 : policy.tier === 'high' ? 1.25 : policy.tier === 'medium' ? 1 : policy.tier === 'low' ? 0.82 : 0.64;
  const motionCost = Math.min(1.2, Math.hypot(body.velocity.x, body.velocity.z) * 0.02);
  return base * qualityMultiplier + motionCost;
};

const performanceNow = (): number =>
  typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : 0;