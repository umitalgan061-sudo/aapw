import{checksum}from'./binaryCodec';
export interface Transform{readonly x:number;readonly y:number;readonly z:number;readonly yaw:number;}
export interface EncodedTransform{readonly values:readonly number[];readonly digest:number;}
export function encodeTransform(t:Transform){const values=[Math.round(t.x*100),Math.round(t.y*100),Math.round(t.z*100),Math.round(t.yaw*10000)];return Object.freeze({values:Object.freeze(values),digest:checksum(new Uint8Array(values.map(v=>v&255)))});}
export function decodeTransform(p:EncodedTransform):Transform{if(p.values.length!==4)throw new Error('TRANSFORM_FORMAT');if(checksum(new Uint8Array(p.values.map(v=>v&255)))!==p.digest)throw new Error('TRANSFORM_DIGEST');return Object.freeze({x:p.values[0]!/100,y:p.values[1]!/100,z:p.values[2]!/100,yaw:p.values[3]!/10000});}
