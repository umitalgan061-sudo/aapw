/** R13 shared compile-time contracts for procedural creature gameplay. */
export interface CreatureSpawnReference { readonly id:string; readonly seatId:string; }
export interface CreatureDeterminismReceipt { readonly seed:number; readonly stable:boolean; readonly digest:string; readonly sampleCount:number; }
export const CREATURE_RUNTIME_R13=Object.freeze({version:13,deterministic:true,proceduralRigging:true,typedOwners:5});
