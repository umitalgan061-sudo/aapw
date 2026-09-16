import { clampV5, type InputCommandV5, type OutcomeV5, okV5, failV5, sequenceV5, tickV5, vec3V5, type SequenceV5, type TickV5, type Vec3V5 } from './runtimeContractV5';

export type InputActionV5 = 'move' | 'look' | 'jump' | 'sprint' | 'interact' | 'attack' | 'block' | 'pause' | 'inventory' | 'map' | 'confirm' | 'cancel';
export interface BindingV5 { readonly action: InputActionV5; readonly codes: readonly string[]; readonly device: InputCommandV5['device']; readonly scale: number; readonly deadzone: number; readonly priority: number; }
export interface InputFrameV5 { readonly tick: TickV5; readonly commands: readonly InputCommandV5[]; readonly movement: Vec3V5; readonly look: Vec3V5; readonly pressed: readonly InputActionV5[]; readonly released: readonly InputActionV5[]; }
export interface InputPipelineOptionsV5 { readonly maxCommands?: number; readonly maxBindings?: number; readonly deadzone?: number; }

const ACTIONS: readonly InputActionV5[] = ['move', 'look', 'jump', 'sprint', 'interact', 'attack', 'block', 'pause', 'inventory', 'map', 'confirm', 'cancel'];
const validAction = (action: string): action is InputActionV5 => ACTIONS.includes(action as InputActionV5);

export class InputPipelineV5 {
  readonly maxCommands: number;
  readonly maxBindings: number;
  readonly defaultDeadzone: number;
  #sequence: SequenceV5 = sequenceV5(0);
  #bindings: BindingV5[] = [];
  #pressed = new Set<InputActionV5>();
  #current = new Map<InputActionV5, number>();
  #previous = new Map<InputActionV5, number>();

  constructor(options: InputPipelineOptionsV5 = {}) {
    this.maxCommands = Math.max(8, Math.min(2048, Math.floor(options.maxCommands ?? 256)));
    this.maxBindings = Math.max(8, Math.min(4096, Math.floor(options.maxBindings ?? 256)));
    this.defaultDeadzone = clampV5(options.deadzone ?? 0.08, 0, 0.5);
  }

  bind(binding: BindingV5): OutcomeV5<void> {
    if (!validAction(binding.action)) return failV5('INPUT_ACTION', 'Unknown input action');
    if (!binding.codes.length || binding.codes.length > 16) return failV5('INPUT_CODES', 'Invalid input binding');
    if (this.#bindings.length >= this.maxBindings) return failV5('INPUT_LIMIT', 'Binding limit reached');
    const normalized: BindingV5 = Object.freeze({ action: binding.action, codes: Object.freeze([...new Set(binding.codes)].slice(0, 16)), device: binding.device, scale: clampV5(binding.scale, -8, 8), deadzone: clampV5(binding.deadzone, 0, 0.5), priority: Math.floor(clampV5(binding.priority, -100, 100)) });
    this.#bindings.push(normalized);
    this.#bindings.sort((a, b) => b.priority - a.priority || a.action.localeCompare(b.action) || a.codes.join(',').localeCompare(b.codes.join(',')));
    return okV5(undefined);
  }

  unbind(action: InputActionV5, device?: BindingV5['device']): number {
    const before = this.#bindings.length;
    this.#bindings = this.#bindings.filter((binding) => binding.action !== action || (device !== undefined && binding.device !== device));
    return before - this.#bindings.length;
  }

  bindings(): readonly BindingV5[] { return Object.freeze(this.#bindings.slice()); }

  installDefaults(): void {
    this.#bindings = [];
    const defaults: BindingV5[] = [
      { action: 'move', codes: ['KeyW', 'KeyA', 'KeyS', 'KeyD'], device: 'keyboard', scale: 1, deadzone: this.defaultDeadzone, priority: 10 },
      { action: 'look', codes: ['MouseX', 'MouseY'], device: 'mouse', scale: 1, deadzone: this.defaultDeadzone, priority: 10 },
      { action: 'jump', codes: ['Space'], device: 'keyboard', scale: 1, deadzone: 0, priority: 20 },
      { action: 'sprint', codes: ['ShiftLeft', 'ShiftRight'], device: 'keyboard', scale: 1, deadzone: 0, priority: 15 },
      { action: 'interact', codes: ['KeyE'], device: 'keyboard', scale: 1, deadzone: 0, priority: 20 },
      { action: 'attack', codes: ['MousePrimary'], device: 'mouse', scale: 1, deadzone: 0, priority: 25 },
      { action: 'block', codes: ['MouseSecondary'], device: 'mouse', scale: 1, deadzone: 0, priority: 25 },
      { action: 'pause', codes: ['Escape'], device: 'keyboard', scale: 1, deadzone: 0, priority: 30 },
      { action: 'inventory', codes: ['KeyI'], device: 'keyboard', scale: 1, deadzone: 0, priority: 20 },
      { action: 'map', codes: ['KeyM'], device: 'keyboard', scale: 1, deadzone: 0, priority: 20 },
    ];
    for (const binding of defaults) this.bind(binding);
  }

  nextCommand(tick: TickV5, action: InputActionV5, value = 1, device: InputCommandV5['device'] = 'programmatic', vector?: Vec3V5, priority = 0): InputCommandV5 {
    this.#sequence = sequenceV5(this.#sequence + 1);
    return Object.freeze({ sequence: this.#sequence, tick, action, value: clampV5(value, -1, 1), vector, device, priority: Math.floor(priority) });
  }

  ingest(tick: TickV5, commands: readonly InputCommandV5[]): InputFrameV5 {
    this.#previous = new Map(this.#current);
    this.#current.clear();
    this.#pressed.clear();
    const accepted = commands.slice(0, this.maxCommands).sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
    let movement = vec3V5(); let look = vec3V5();
    const frameCommands: InputCommandV5[] = [];
    for (const command of accepted) {
      if (command.tick !== tick || !validAction(command.action)) continue;
      const value = Math.abs(command.value) < this.defaultDeadzone ? 0 : clampV5(command.value, -1, 1);
      this.#current.set(command.action, Math.max(this.#current.get(command.action) ?? 0, Math.abs(value)));
      if (command.action === 'move' && command.vector) movement = vec3V5(clampV5(movement.x + command.vector.x * value, -1, 1), clampV5(movement.y + command.vector.y * value, -1, 1), clampV5(movement.z + command.vector.z * value, -1, 1));
      if (command.action === 'look' && command.vector) look = vec3V5(clampV5(look.x + command.vector.x * value, -4, 4), clampV5(look.y + command.vector.y * value, -4, 4), clampV5(look.z + command.vector.z * value, -4, 4));
      frameCommands.push(Object.freeze({ ...command, value }));
    }
    const pressed: InputActionV5[] = []; const released: InputActionV5[] = [];
    for (const action of ACTIONS) { const now = (this.#current.get(action) ?? 0) > 0; const was = (this.#previous.get(action) ?? 0) > 0; if (now && !was) pressed.push(action); if (was && !now) released.push(action); }
    return Object.freeze({ tick, commands: Object.freeze(frameCommands), movement, look, pressed: Object.freeze(pressed), released: Object.freeze(released) });
  }

  applyKey(tick: TickV5, code: string, pressed: boolean, device: BindingV5['device'] = 'keyboard'): OutcomeV5<InputCommandV5 | null> {
    const binding = this.#bindings.find((candidate) => candidate.device === device && candidate.codes.includes(code));
    if (!binding) return okV5(null);
    const command = this.nextCommand(tick, binding.action, pressed ? 1 : 0, device, undefined, binding.priority);
    return okV5(command);
  }

  clearState(): void { this.#pressed.clear(); this.#current.clear(); this.#previous.clear(); }
  isDown(action: InputActionV5): boolean { return (this.#current.get(action) ?? 0) > 0; }
  value(action: InputActionV5): number { return this.#current.get(action) ?? 0; }
  wasPressed(action: InputActionV5): boolean { return this.isDown(action) && (this.#previous.get(action) ?? 0) <= 0; }
  wasReleased(action: InputActionV5): boolean { return !this.isDown(action) && (this.#previous.get(action) ?? 0) > 0; }
}

export function normalizeLookV5(vector: Vec3V5, sensitivity = 1): Vec3V5 { const scale = clampV5(sensitivity, 0.01, 10); return vec3V5(clampV5(vector.x * scale, -20, 20), clampV5(vector.y * scale, -20, 20), clampV5(vector.z * scale, -20, 20)); }
