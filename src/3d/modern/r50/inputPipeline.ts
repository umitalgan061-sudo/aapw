import {asFrameIndex,asTick,clampFinite,stableHash} from './contracts.ts';
import type {FrameIndex,Tick,Vec2} from './contracts.ts';

  FrameIndex,
  Tick,
  Vec2,
  asFrameIndex,
  asTick,
  clampFinite,
  stableHash,
} from './contracts.ts';

export type InputAction =
  | 'move'
  | 'look'
  | 'jump'
  | 'sprint'
  | 'dodge'
  | 'attack'
  | 'block'
  | 'interact'
  | 'inventory'
  | 'map'
  | 'pause'
  | 'camera';

export type InputDevice =
  | 'keyboard'
  | 'mouse'
  | 'touch'
  | 'gamepad'
  | 'synthetic';

export type InputPhase =
  | 'started'
  | 'changed'
  | 'ended';

export interface InputSample {
  readonly action: InputAction;
  readonly device: InputDevice;
  readonly phase: InputPhase;
  readonly value: number;
  readonly vector?: Vec2;
  readonly tick: Tick;
  readonly frame: FrameIndex;
  readonly rawCode?: string;
}

export interface InputBinding {
  readonly action: InputAction;
  readonly device: InputDevice;
  readonly code: string;
  readonly scale: number;
  readonly deadzone?: number;
}

export interface InputContext {
  readonly id: string;
  readonly priority: number;
  readonly enabled: boolean;
  readonly bindings: readonly InputBinding[];
}

export interface InputIntentSnapshot {
  readonly move: Vec2;
  readonly look: Vec2;
  readonly held: ReadonlySet<InputAction>;
  readonly pressed: ReadonlySet<InputAction>;
  readonly released: ReadonlySet<InputAction>;
  readonly tick: Tick;
  readonly frame: FrameIndex;
  readonly digest: string;
}

interface BindingState {
  value: number;
  vector: Vec2;
  active: boolean;
}

export interface InputPipelineOptions {
  readonly recordingLimit: number;
  readonly maxContexts: number;
}

const DEFAULT_OPTIONS: InputPipelineOptions = {
  recordingLimit: 600,
  maxContexts: 16,
};

export class InputIntentPipeline {
  readonly #options: InputPipelineOptions;
  readonly #contexts = new Map<string, InputContext>();
  readonly #states = new Map<string, BindingState>();
  readonly #recording: InputSample[] = [];
  readonly #held = new Set<InputAction>();
  readonly #pressed = new Set<InputAction>();
  readonly #released = new Set<InputAction>();

  #tick: Tick = asTick(0);
  #frame: FrameIndex = asFrameIndex(0);
  #move: Vec2 = { x: 0, y: 0 };
  #look: Vec2 = { x: 0, y: 0 };

  constructor(options: Partial<InputPipelineOptions> = {}) {
    this.#options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
  }

  registerContext(context: InputContext): () => void {
    if (!context.id.trim()) {
      throw new Error('Input context id cannot be empty.');
    }

    if (
      this.#contexts.size >= this.#options.maxContexts
      && !this.#contexts.has(context.id)
    ) {
      throw new Error('Input context limit exceeded.');
    }

    if (this.#contexts.has(context.id)) {
      throw new Error('Input context already exists: ' + context.id);
    }

    this.#contexts.set(context.id, {
      ...context,
      bindings: context.bindings.slice(),
    });

    return () => {
      this.#contexts.delete(context.id);
    };
  }

  setContextEnabled(id: string, enabled: boolean): void {
    const context = this.#contexts.get(id);

    if (!context) {
      throw new Error('Unknown input context: ' + id);
    }

    this.#contexts.set(id, {
      ...context,
      enabled,
    });
  }

  beginTick(tick: Tick, frame: FrameIndex): void {
    this.#tick = tick;
    this.#frame = frame;
    this.#pressed.clear();
    this.#released.clear();
  }

  consume(sample: InputSample): boolean {
    if (sample.tick !== this.#tick) {
      return false;
    }

    if (sample.frame !== this.#frame) {
      return false;
    }

    const binding = this.#findBinding(sample);

    if (!binding) {
      return false;
    }

    const key = this.#stateKey(binding);
    const state = this.#states.get(key) ?? {
      value: 0,
      vector: { x: 0, y: 0 },
      active: false,
    };

    const magnitude = sample.vector
      ? Math.hypot(sample.vector.x, sample.vector.y)
      : Math.abs(sample.value);

    const deadzone = Math.max(0, binding.deadzone ?? 0);

    if (magnitude < deadzone) {
      return true;
    }

    state.value = clampFinite(
      sample.value * binding.scale,
      -1,
      1,
    );

    state.vector = {
      x: clampFinite(
        (sample.vector?.x ?? sample.value) * binding.scale,
        -1,
        1,
      ),
      y: clampFinite(
        (sample.vector?.y ?? 0) * binding.scale,
        -1,
        1,
      ),
    };

    if (sample.phase === 'started') {
      state.active = true;
      this.#pressed.add(binding.action);
      this.#held.add(binding.action);
    }

    if (sample.phase === 'changed') {
      state.active = true;
      this.#held.add(binding.action);
    }

    if (sample.phase === 'ended') {
      state.active = false;
      this.#released.add(binding.action);
      this.#held.delete(binding.action);
    }

    this.#states.set(key, state);
    this.#record(sample);
    this.#recalculateAxes();

    return true;
  }

  snapshot(): InputIntentSnapshot {
    const move = this.#move;
    const look = this.#look;
    const held = new Set(this.#held);
    const pressed = new Set(this.#pressed);
    const released = new Set(this.#released);

    const digest = stableHash({
      move,
      look,
      held: [...held].sort(),
      pressed: [...pressed].sort(),
      released: [...released].sort(),
      tick: this.#tick,
      frame: this.#frame,
    });

    return {
      move,
      look,
      held,
      pressed,
      released,
      tick: this.#tick,
      frame: this.#frame,
      digest,
    };
  }

  isPressed(action: InputAction): boolean {
    return this.#pressed.has(action);
  }

  isHeld(action: InputAction): boolean {
    return this.#held.has(action);
  }

  isReleased(action: InputAction): boolean {
    return this.#released.has(action);
  }

  axis(action: InputAction): number {
    let value = 0;

    for (const binding of this.#activeBindings(action)) {
      const state = this.#states.get(this.#stateKey(binding));

      if (state) {
        value += state.value;
      }
    }

    return clampFinite(value, -1, 1);
  }

  vector(action: InputAction): Vec2 {
    let x = 0;
    let y = 0;

    for (const binding of this.#activeBindings(action)) {
      const state = this.#states.get(this.#stateKey(binding));

      if (!state) {
        continue;
      }

      x += state.vector.x;
      y += state.vector.y;
    }

    const length = Math.hypot(x, y);

    if (length > 1) {
      return {
        x: x / length,
        y: y / length,
      };
    }

    return {
      x,
      y,
    };
  }

  recorded(): readonly InputSample[] {
    return this.#recording.slice();
  }

  clearRecording(): void {
    this.#recording.length = 0;
  }

  replay(samples: readonly InputSample[]): void {
    for (const sample of samples) {
      this.beginTick(sample.tick, sample.frame);
      this.consume(sample);
    }
  }

  reset(): void {
    this.#states.clear();
    this.#held.clear();
    this.#pressed.clear();
    this.#released.clear();
    this.#recording.length = 0;
    this.#move = { x: 0, y: 0 };
    this.#look = { x: 0, y: 0 };
  }

  #findBinding(sample: InputSample): InputBinding | undefined {
    const contexts = [...this.#contexts.values()]
      .filter((context) => context.enabled)
      .sort((left, right) => right.priority - left.priority);

    for (const context of contexts) {
      const binding = context.bindings.find(
        (candidate) =>
          candidate.device === sample.device
          && candidate.action === sample.action
          && candidate.code === sample.rawCode,
      );

      if (binding) {
        return binding;
      }
    }

    return undefined;
  }

  #activeBindings(action: InputAction): readonly InputBinding[] {
    return [...this.#contexts.values()]
      .filter((context) => context.enabled)
      .sort((left, right) => right.priority - left.priority)
      .flatMap((context) =>
        context.bindings.filter((binding) => binding.action === action),
      );
  }

  #stateKey(binding: InputBinding): string {
    return binding.device + ':' + binding.code;
  }

  #recalculateAxes(): void {
    this.#move = this.vector('move');
    this.#look = this.vector('look');
  }

  #record(sample: InputSample): void {
    this.#recording.push(sample);

    while (this.#recording.length > this.#options.recordingLimit) {
      this.#recording.shift();
    }
  }
}

export const DEFAULT_INPUT_BINDINGS: readonly InputBinding[] = [
  {
    action: 'move',
    device: 'keyboard',
    code: 'KeyW',
    scale: 1,
  },
  {
    action: 'move',
    device: 'keyboard',
    code: 'KeyS',
    scale: -1,
  },
  {
    action: 'move',
    device: 'keyboard',
    code: 'KeyA',
    scale: -1,
  },
  {
    action: 'move',
    device: 'keyboard',
    code: 'KeyD',
    scale: 1,
  },
  {
    action: 'jump',
    device: 'keyboard',
    code: 'Space',
    scale: 1,
  },
  {
    action: 'sprint',
    device: 'keyboard',
    code: 'ShiftLeft',
    scale: 1,
  },
  {
    action: 'dodge',
    device: 'keyboard',
    code: 'KeyQ',
    scale: 1,
  },
  {
    action: 'attack',
    device: 'mouse',
    code: '0',
    scale: 1,
  },
  {
    action: 'block',
    device: 'mouse',
    code: '2',
    scale: 1,
  },
  {
    action: 'interact',
    device: 'keyboard',
    code: 'KeyE',
    scale: 1,
  },
  {
    action: 'inventory',
    device: 'keyboard',
    code: 'KeyI',
    scale: 1,
  },
  {
    action: 'map',
    device: 'keyboard',
    code: 'KeyM',
    scale: 1,
  },
  {
    action: 'pause',
    device: 'keyboard',
    code: 'Escape',
    scale: 1,
  },
];

export function createDefaultInputPipeline(): InputIntentPipeline {
  const pipeline = new InputIntentPipeline();

  pipeline.registerContext({
    id: 'gameplay',
    priority: 100,
    enabled: true,
    bindings: DEFAULT_INPUT_BINDINGS,
  });

  return pipeline;
}
