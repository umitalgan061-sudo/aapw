import {RuntimeError,stableHash} from './contracts.ts';

  RuntimeError,
  stableHash,
} from './contracts.ts';

export interface BinarySnapshotHeader {
  readonly magic: string;
  readonly version: number;
  readonly payloadBytes: number;
  readonly checksum: string;
  readonly flags: number;
}

export interface SnapshotCodecOptions {
  readonly magic: string;
  readonly version: number;
  readonly maxPayloadBytes: number;
}

export interface EncodedSnapshot<T> {
  readonly header: BinarySnapshotHeader;
  readonly payload: T;
  readonly encoded: string;
}

const DEFAULT_OPTIONS: SnapshotCodecOptions = {
  magic: 'AAPW32',
  version: 1,
  maxPayloadBytes: 4 * 1024 * 1024,
};

function encodeBase64(value: string): string {
  if (typeof btoa === 'function') {
    return btoa(
      String.fromCharCode(
        ...new TextEncoder().encode(value),
      ),
    );
  }

  const bytes = new TextEncoder().encode(value);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return globalThis.Buffer.from(binary,'binary').toString('base64');
}

function decodeBase64(value: string): string {
  if (typeof atob === 'function') {
    const binary = atob(value);
    const bytes = Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0),
    );

    return new TextDecoder().decode(bytes);
  }

  const binary = globalThis.Buffer.from(value,'base64').toString('binary');
  const bytes = Uint8Array.from(
    binary,
    (character) => character.charCodeAt(0),
  );

  return new TextDecoder().decode(bytes);
}

export class JsonSnapshotCodec {
  readonly #options: SnapshotCodecOptions;

  constructor(options: Partial<SnapshotCodecOptions> = {}) {
    this.#options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
  }

  encode<T>(payload:T,flags=0):EncodedSnapshot<T>{
    const json=JSON.stringify(payload);
    const payloadBytes=new TextEncoder().encode(json).byteLength;

    if(payloadBytes>this.#options.maxPayloadBytes){
      throw new RuntimeError({
        code:'R50_SNAPSHOT_SIZE',
        message:'Snapshot payload exceeds configured size limit.',
        recoverable:false,
      });
    }

    const header:BinarySnapshotHeader={
      magic:this.#options.magic,
      version:this.#options.version,
      payloadBytes,
      checksum:stableHash(payload),
      flags,
    };

    const encoded=encodeBase64(
      JSON.stringify({
        header,
        payload,
      }),
    );

    return {
      header,
      payload,
      encoded,
    };
  }

  decode<T>(encoded:string):EncodedSnapshot<T>{
    let decoded:unknown;

    try{
      decoded=JSON.parse(decodeBase64(encoded));
    }catch(error){
      throw new RuntimeError({
        code:'R50_SNAPSHOT_DECODE',
        message:'Snapshot data could not be decoded.',
        cause:error,
        recoverable:false,
      });
    }

    if(
      !decoded
      || typeof decoded!=='object'
      || Array.isArray(decoded)
    ){
      throw new RuntimeError({
        code:'R50_SNAPSHOT_FORMAT',
        message:'Snapshot container is invalid.',
        recoverable:false,
      });
    }

    const record=decoded as Record<string,unknown>;
    const headerValue=record.header;
    const payload=record.payload;

    if(
      !headerValue
      || typeof headerValue!=='object'
      || Array.isArray(headerValue)
    ){
      throw new RuntimeError({
        code:'R50_SNAPSHOT_HEADER',
        message:'Snapshot header is missing.',
        recoverable:false,
      });
    }

    const header=headerValue as Record<string,unknown>;

    if(
      header.magic!==this.#options.magic
      || header.version!==this.#options.version
      || typeof header.payloadBytes!=='number'
      || typeof header.checksum!=='string'
      || typeof header.flags!=='number'
    ){
      throw new RuntimeError({
        code:'R50_SNAPSHOT_VERSION',
        message:'Snapshot header is incompatible.',
        recoverable:false,
      });
    }

    const actualBytes=new TextEncoder().encode(
      JSON.stringify(payload),
    ).byteLength;

    if(actualBytes!==header.payloadBytes){
      throw new RuntimeError({
        code:'R50_SNAPSHOT_BYTES',
        message:'Snapshot payload size does not match header.',
        recoverable:false,
      });
    }

    if(actualBytes>this.#options.maxPayloadBytes){
      throw new RuntimeError({
        code:'R50_SNAPSHOT_SIZE',
        message:'Snapshot payload exceeds configured size limit.',
        recoverable:false,
      });
    }

    if(stableHash(payload)!==header.checksum){
      throw new RuntimeError({
        code:'R50_SNAPSHOT_CHECKSUM',
        message:'Snapshot checksum mismatch.',
        recoverable:false,
      });
    }

    return {
      header:header as unknown as BinarySnapshotHeader,
      payload:payload as T,
      encoded,
    };
  }
}

export interface SnapshotHistoryEntry<T>{
  readonly tick:number;
  readonly encoded:EncodedSnapshot<T>;
}

export class SnapshotHistory<T>{
  readonly #limit:number;
  readonly #codec:JsonSnapshotCodec;
  readonly #entries:SnapshotHistoryEntry<T>[]=[];

  constructor(
    codec:JsonSnapshotCodec,
    limit=120,
  ){
    this.#codec=codec;
    this.#limit=Math.max(1,Math.floor(limit));
  }

  push(
    tick:number,
    state:T,
    flags=0,
  ):SnapshotHistoryEntry<T>{
    const entry={
      tick,
      encoded:this.#codec.encode(state,flags),
    };

    this.#entries.push(entry);

    while(this.#entries.length>this.#limit){
      this.#entries.shift();
    }

    return entry;
  }

  latest():SnapshotHistoryEntry<T>|null{
    return this.#entries.at(-1)??null;
  }

  at(index:number):SnapshotHistoryEntry<T>|null{
    return this.#entries[index]??null;
  }

  beforeOrAt(tick:number):SnapshotHistoryEntry<T>|null{
    let result:SnapshotHistoryEntry<T>|null=null;

    for(const entry of this.#entries){
      if(entry.tick>tick)break;
      result=entry;
    }

    return result;
  }

  values():readonly SnapshotHistoryEntry<T>[]{
    return this.#entries.slice();
  }

  clear():void{
    this.#entries.length=0;
  }
}
