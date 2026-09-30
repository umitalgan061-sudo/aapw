import type { RuntimeCommandKind } from './applicationTypesR31.ts';
import { asR31Id } from './applicationTypesR31.ts';
import { validatePayloadR31 } from './securityR31.ts';

export type WorkerMessageR31 =
  | {
      readonly type: 'request';
      readonly id: string;
      readonly operation: string;
      readonly payload: unknown;
      readonly issuedAtTick: number;
    }
  | {
      readonly type: 'response';
      readonly id: string;
      readonly ok: boolean;
      readonly payload: unknown;
      readonly error: string | null;
    }
  | {
      readonly type: 'cancel';
      readonly id: string;
    };

export interface WorkerRequestR31 {
  readonly id: string;
  readonly operation: RuntimeCommandKind | string;
  readonly payload: unknown;
  readonly issuedAtTick: number;
}

export interface WorkerProtocolDiagnosticsR31 {
  readonly encoded: number;
  readonly decoded: number;
  readonly rejected: number;
  readonly cancelled: number;
  readonly bytesEncoded: number;
  readonly bytesDecoded: number;
}

export class WorkerProtocolR31 {
  #encoded = 0;
  #decoded = 0;
  #rejected = 0;
  #cancelled = 0;
  #bytesEncoded = 0;
  #bytesDecoded = 0;
  readonly #cancelledIds = new Set<string>();

  encodeRequest(request: WorkerRequestR31): Uint8Array | null {
    if (!Number.isInteger(request.issuedAtTick) || request.issuedAtTick < 0) {
      this.#rejected++;
      return null;
    }
    const validation = validatePayloadR31(request.payload);
    if (!validation.allowed) {
      this.#rejected++;
      return null;
    }
    const message: WorkerMessageR31 = Object.freeze({
      type: 'request',
      id: String(asR31Id(request.id)),
      operation: request.operation,
      payload: validation.normalized,
      issuedAtTick: request.issuedAtTick,
    });
    const bytes = new TextEncoder().encode(JSON.stringify(message));
    this.#encoded++;
    this.#bytesEncoded += bytes.byteLength;
    return bytes;
  }

  decode(bytes: Uint8Array): WorkerMessageR31 | null {
    try {
      const input = JSON.parse(new TextDecoder().decode(bytes)) as WorkerMessageR31;
      if (!input || typeof input !== 'object') throw new Error('invalid-message');
      if (input.type === 'cancel') {
        if (!input.id) throw new Error('cancel-id-empty');
        this.#cancelledIds.add(input.id);
        this.#cancelled++;
      } else if (!input.id) {
        throw new Error('message-id-empty');
      }
      if (input.type === 'request') {
        if (!Number.isInteger(input.issuedAtTick) || input.issuedAtTick < 0) throw new Error('request-tick-invalid');
        const validation = validatePayloadR31(input.payload);
        if (!validation.allowed) throw new Error(validation.reason);
      }
      this.#decoded++;
      this.#bytesDecoded += bytes.byteLength;
      return Object.freeze(input);
    } catch {
      this.#rejected++;
      return null;
    }
  }

  isCancelled(id: string): boolean {
    return this.#cancelledIds.has(id);
  }

  clearCancellation(id: string): void {
    this.#cancelledIds.delete(id);
  }

  diagnostics(): WorkerProtocolDiagnosticsR31 {
    return Object.freeze({
      encoded: this.#encoded,
      decoded: this.#decoded,
      rejected: this.#rejected,
      cancelled: this.#cancelled,
      bytesEncoded: this.#bytesEncoded,
      bytesDecoded: this.#bytesDecoded,
    });
  }
}
