import type { RuntimeEvent } from '../r27/contracts.ts';

export type LifecycleState =
  | 'created'
  | 'mounting'
  | 'mounted'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'disposing'
  | 'disposed'
  | 'failed';

export type LifecycleAction =
  | 'mount'
  | 'start'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'dispose'
  | 'fail';

export interface LifecycleTransition {
  readonly from: LifecycleState;
  readonly action: LifecycleAction;
  readonly to: LifecycleState;
}

export interface LifecycleComponent {
  readonly id: string;
  readonly mount?: () => void | Promise<void>;
  readonly start?: () => void;
  readonly pause?: () => void;
  readonly resume?: () => void;
  readonly stop?: () => void | Promise<void>;
  readonly dispose?: () => void;
}

const TRANSITIONS: readonly LifecycleTransition[] = [
  { from: 'created', action: 'mount', to: 'mounting' },
  { from: 'mounting', action: 'start', to: 'mounted' },
  { from: 'mounted', action: 'start', to: 'running' },
  { from: 'running', action: 'pause', to: 'pausing' },
  { from: 'pausing', action: 'resume', to: 'paused' },
  { from: 'paused', action: 'resume', to: 'running' },
  { from: 'running', action: 'stop', to: 'stopping' },
  { from: 'paused', action: 'stop', to: 'stopping' },
  { from: 'stopping', action: 'dispose', to: 'disposed' },
  { from: 'created', action: 'dispose', to: 'disposed' },
  { from: 'mounted', action: 'dispose', to: 'disposed' },
  { from: 'running', action: 'dispose', to: 'disposing' },
  { from: 'paused', action: 'dispose', to: 'disposing' },
  { from: 'disposing', action: 'stop', to: 'disposed' },
  { from: 'created', action: 'fail', to: 'failed' },
  { from: 'mounting', action: 'fail', to: 'failed' },
  { from: 'mounted', action: 'fail', to: 'failed' },
  { from: 'running', action: 'fail', to: 'failed' },
];

export class RuntimeLifecycleController {
  #state: LifecycleState = 'created';
  #components = new Map<string, LifecycleComponent>();
  #events: RuntimeEvent[] = [];

  get state(): LifecycleState {
    return this.#state;
  }

  register(component: LifecycleComponent): void {
    if (!component.id.trim()) throw new RangeError('Lifecycle component id is required');
    if (this.#components.has(component.id)) throw new Error('Lifecycle component already registered: ' + component.id);
    this.#components.set(component.id, component);
  }

  registerMany(components: readonly LifecycleComponent[]): void {
    for (const component of components) this.register(component);
  }

  async mount(): Promise<void> {
    this.#transition('mount');
    const components = this.#orderedComponents();
    try {
      for (const component of components) await component.mount?.();
      this.#transition('start');
    } catch (error) {
      this.#emitFailure(error);
      throw error;
    }
  }

  start(): void {
    this.#transition('start');
    for (const component of this.#orderedComponents()) component.start?.();
  }

  pause(): void {
    this.#transition('pause');
    for (const component of this.#orderedComponents().reverse()) component.pause?.();
    this.#transition('resume');
  }

  resume(): void {
    this.#transition('resume');
    for (const component of this.#orderedComponents()) component.resume?.();
  }

  async stop(): Promise<void> {
    if (this.#state === 'created' || this.#state === 'disposed') return;
    this.#transition('stop');
    for (const component of this.#orderedComponents().reverse()) await component.stop?.();
    if (this.#state === 'stopping') this.#state = 'stopped';
  }

  async dispose(): Promise<void> {
    if (this.#state === 'disposed') return;
    if (this.#state === 'running' || this.#state === 'paused') {
      this.#state = 'disposing';
    } else if (this.#state === 'stopping') {
      await this.stop();
      this.#state = 'disposing';
    }
    for (const component of this.#orderedComponents().reverse()) component.dispose?.();
    this.#state = 'disposed';
  }

  fail(error: unknown): void {
    this.#emitFailure(error);
  }

  events(): readonly RuntimeEvent[] {
    return [...this.#events];
  }

  clearEvents(): void {
    this.#events = [];
  }

  #transition(action: LifecycleAction): void {
    const transition = TRANSITIONS.find((item) => item.from === this.#state && item.action === action);
    if (!transition) {
      throw new Error('Invalid lifecycle transition: ' + this.#state + ' -> ' + action);
    }
    this.#state = transition.to;
  }

  #emitFailure(error: unknown): void {
    this.#state = 'failed';
    this.#events.push({
      type: 'incident',
      code: 'R28_LIFECYCLE_FAILURE',
      severity: 'critical',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  #orderedComponents(): LifecycleComponent[] {
    return [...this.#components.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}
