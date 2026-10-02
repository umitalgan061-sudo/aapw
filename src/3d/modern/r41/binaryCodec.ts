import type{BinaryFrame}from'./contracts';
import{hashBytes}from'./hash';
const MAGIC=0xa4;
const VERSION=1;
export class BinaryWriter{
 #data:number[]=[];
 writeU8(v:number){this.#data.push(v&255);return this;}
 writeU32(v:number){const n=v>>>0;this.#data.push(n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255);return this;}
 writeVarUint(v:number){let n=Math.max(0,Math.trunc(v));while(n>=128){this.#data.push((n&127)|128);n=Math.floor(n/128);}this.#data.push(n&127);return this;}
 writeString(v:string){const b=new TextEncoder().encode(v);this.writeVarUint(b.length);for(const byte of b)this.#data.push(byte);return this;}
 writeBytes(v:Uint8Array){this.writeVarUint(v.length);for(const byte of v)this.#data.push(byte);return this;}
 bytes(){return Uint8Array.from(this.#data);}
}
export class BinaryReader{
 readonly data:Uint8Array;#offset=0;
 constructor(data:Uint8Array){this.data=data;}
 readU8(){return this.take(1)[0]!;}
 readU32(){const a=this.take(4);return(a[0]!|(a[1]!<<8)|(a[2]!<<16)|(a[3]!<<24))>>>0;}
 readVarUint(){let result=0;let shift=0;for(let i=0;i<5;i+=1){const b=this.readU8();result+=(b&127)*2**shift;if(!(b&128))return result;shift+=7;}throw new Error('BINARY_VARINT_OVERFLOW');}
 readString(){return new TextDecoder().decode(this.take(this.readVarUint()));}
 readBytes(){return this.take(this.readVarUint()).slice();}
 remaining(){return this.data.length-this.#offset;}
 private take(n:number){if(n<0||this.#offset+n>this.data.length)throw new Error('BINARY_TRUNCATED');const b=this.data.slice(this.#offset,this.#offset+n);this.#offset+=n;return b;}
}
export function encodeFrame(sequence:number,ack:number,payload:Uint8Array,flags=0){const body=new BinaryWriter().writeU8(MAGIC).writeU8(VERSION).writeU8(flags).writeU32(sequence).writeU32(ack).writeBytes(payload).bytes();const h=hashBytes(body);const out=new Uint8Array(body.length+4);out.set(body);new DataView(out.buffer).setUint32(body.length,h,true);return out;}
export function decodeFrame(data:Uint8Array):BinaryFrame{if(data.length<12)throw new Error('BINARY_FRAME_TOO_SMALL');const expected=new DataView(data.buffer,data.byteOffset+data.byteLength-4,4).getUint32(0,true);const actual=hashBytes(data.slice(0,-4));if(expected!==actual)throw new Error('BINARY_CHECKSUM_MISMATCH');const r=new BinaryReader(data.slice(0,-4));if(r.readU8()!==MAGIC)throw new Error('BINARY_MAGIC_MISMATCH');const version=r.readU8();if(version!==VERSION)throw new Error('BINARY_VERSION_UNSUPPORTED');const flags=r.readU8();const sequence=r.readU32();const ack=r.readU32();const payload=r.readBytes();if(r.remaining()!==0)throw new Error('BINARY_FRAME_LENGTH_MISMATCH');return Object.freeze({version,flags,sequence,ack,payload,digest:actual});}
export const checksum=hashBytes;
