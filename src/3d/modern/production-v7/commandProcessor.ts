import { CommandEnvelopeV7, EntityIdV7, RuntimeCommandV7, SequenceV7, TickV7, entityIdV7, revisionV7, sequenceV7, tickV7 } from './types.ts';
import { EntityStoreV7 } from './entityStore.ts';
import { RuntimeSecurityV7 } from './security.ts';
import { RuntimeValidatorV7 } from './validation.ts';
import { checksumV7 } from './deterministic.ts';

export type CommandResultCodeV7 = 'applied' | 'duplicate' | 'invalid' | 'missing-entity' | 'rejected' | 'rate-limited';

export interface CommandReceiptV7 {
  readonly code: CommandResultCodeV7;
  readonly sequence: SequenceV7;
  readonly tick: TickV7;
  readonly revision: number;
  readonly checksum: string;
}

export interface CommandProcessorStatsV7 {
  readonly applied: number;
  readonly duplicate: number;
  readonly invalid: number;
  readonly missingEntity: number;
  readonly rejected: number;
}

export interface CommandProcessorOptionsV7 {
  readonly maxHistory: number;
  readonly maxCommandsPerTick: number;
}

const DEFAULT_OPTIONS: CommandProcessorOptionsV7 = Object.freeze({ maxHistory: 4096, maxCommandsPerTick: 64 });

export class CommandProcessorV7 {
  readonly #entities: EntityStoreV7;
  readonly #security: RuntimeSecurityV7;
  readonly #validator: RuntimeValidatorV7;
  readonly #history = new Map<number, CommandReceiptV7>();
  readonly #perTick = new Map<number, number>();
  readonly #options: CommandProcessorOptionsV7;
  #sequence = 0;
  #revision = 0;
  #stats = { applied: 0, duplicate: 0, invalid: 0, missingEntity: 0, rejected: 0 };

  constructor(entities: EntityStoreV7, security = new RuntimeSecurityV7(), validator = new RuntimeValidatorV7(), options: Partial<CommandProcessorOptionsV7> = {}) {
    this.#entities = entities; this.#security = security; this.#validator = validator; this.#options = Object.freeze({ ...DEFAULT_OPTIONS, ...options });
  }

  get revision(): number { return this.#revision; }
  nextSequence(): SequenceV7 { return sequenceV7(this.#sequence + 1); }

  dispatch(command: RuntimeCommandV7, tick: TickV7): CommandReceiptV7 {
    const validation = this.#validator.validateCommand(command);
    if (!validation.ok) return this.#receipt('invalid', tick, checksumV7(validation.failures));
    const commandHash = Number.parseInt(checksumV7(command).slice(0, 8), 16) >>> 0;
    if (this.#history.has(commandHash)) {
      this.#stats.duplicate += 1;
      return this.#history.get(commandHash)!;
    }
    const perTick = (this.#perTick.get(Number(tick)) ?? 0) + 1;
    if (perTick > this.#options.maxCommandsPerTick) {
      this.#stats.rejected += 1;
      return this.#receipt('rate-limited', tick, checksumV7({ commandHash, tick, perTick }));
    }
    if (!this.#security.validateCommand(command, tick)) {
      this.#stats.rejected += 1;
      return this.#receipt('rejected', tick, checksumV7({ commandHash, tick }));
    }
    this.#perTick.set(Number(tick), perTick);
    const sequence = sequenceV7(++this.#sequence);
    const envelope: CommandEnvelopeV7 = Object.freeze({ sequence, tick, revision: revisionV7(this.#revision), command });
    const code = this.#apply(envelope);
    const receipt = this.#receipt(code, tick, checksumV7(envelope), sequence);
    this.#history.set(commandHash, receipt);
    while (this.#history.size > this.#options.maxHistory) this.#history.delete(this.#history.keys().next().value as number);
    if (code === 'applied') this.#stats.applied += 1;
    return receipt;
  }

  applyEnvelope(envelope: CommandEnvelopeV7): CommandReceiptV7 {
    if (Number(envelope.sequence) <= 0 || Number(envelope.tick) < 0) return this.#receipt('invalid', envelope.tick, checksumV7(envelope));
    const code = this.#apply(envelope);
    return this.#receipt(code, envelope.tick, checksumV7(envelope), envelope.sequence);
  }

  stats(): CommandProcessorStatsV7 { return Object.freeze({ ...this.#stats }); }

  history(): readonly CommandReceiptV7[] { return Object.freeze([...this.#history.values()]); }

  reset(): void { this.#history.clear(); this.#perTick.clear(); this.#sequence = 0; this.#revision = 0; this.#stats = { applied: 0, duplicate: 0, invalid: 0, missingEntity: 0, rejected: 0 }; }

  #apply(envelope: CommandEnvelopeV7): CommandResultCodeV7 {
    const command = envelope.command;
    switch (command.type) {
      case 'spawn':
        try { this.#entities.upsert({ id: command.id, archetype: command.archetype, components: command.components, createdTick: envelope.tick }); }
        catch { this.#stats.rejected += 1; return 'rejected'; }
        break;
      case 'despawn':
        if (!this.#entities.remove(command.id)) { this.#stats.missingEntity += 1; return 'missing-entity'; }
        break;
      case 'move': {
        const entity = this.#entities.get(command.id);
        if (!entity) { this.#stats.missingEntity += 1; return 'missing-entity'; }
        this.#entities.setTransform(command.id, { ...entity.components.transform, position: command.position });
        this.#entities.setKinematics(command.id, { ...entity.components.kinematics, velocity: command.velocity });
        break;
      }
      case 'damage':
        if (this.#entities.applyDamage(command.id, command.amount, envelope.tick) <= 0) { this.#stats.missingEntity += 1; return 'missing-entity'; }
        break;
      case 'heal':
        if (this.#entities.heal(command.id, command.amount) <= 0) { this.#stats.missingEntity += 1; return 'missing-entity'; }
        break;
      case 'interest': {
        const entity = this.#entities.get(command.id);
        if (!entity) { this.#stats.missingEntity += 1; return 'missing-entity'; }
        this.#entities.setInterest(command.id, { ...entity.components.interest, priority: command.priority, simulationLod: command.simulationLod, renderLod: command.renderLod });
        break;
      }
      case 'tag':
        if (command.enabled ? !this.#entities.addTag(command.id, command.tag) : !this.#entities.removeTag(command.id, command.tag)) {
          this.#stats.missingEntity += 1; return 'missing-entity';
        }
        break;
      case 'mode':
        break;
    }
    this.#revision += 1;
    return 'applied';
  }

  #receipt(code: CommandResultCodeV7, tick: TickV7, checksum: string, sequence: SequenceV7 = sequenceV7(this.#sequence)): CommandReceiptV7 {
    return Object.freeze({ code, sequence, tick, revision: this.#revision, checksum });
  }
}

export const createCommandProcessorV7 = (entities: EntityStoreV7): CommandProcessorV7 => new CommandProcessorV7(entities);
