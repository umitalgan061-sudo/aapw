import { digestValue } from './deterministic.js';
import type { R16ReplayEntry } from './replayJournal.js';

export interface R16ReplayVerification{
  readonly accepted:boolean;
  readonly entryCount:number;
  readonly firstDigest:string;
  readonly lastDigest:string;
  readonly mismatchIndex:number|null;
  readonly reason:string|null;
  readonly digest:string;
}

export class R16ReplayVerifier{
  compare(expected:readonly R16ReplayEntry[],actual:readonly R16ReplayEntry[]):R16ReplayVerification{
    const length=Math.max(expected.length,actual.length);
    let mismatchIndex:number|null=null;
    for(let i=0;i<length;i++){
      const left=expected[i]?.digest;
      const right=actual[i]?.digest;
      if(left!==right){mismatchIndex=i;break;}
    }
    const accepted=mismatchIndex===null&&expected.length===actual.length;
    const result={accepted,entryCount:length,firstDigest:expected[0]?.digest??actual[0]?.digest??'',lastDigest:expected.at(-1)?.digest??actual.at(-1)?.digest??'',mismatchIndex,reason:accepted?null:'replay-entry-mismatch'};
    return Object.freeze({...result,digest:digestValue(result)});
  }
  verifyMonotonic(entries:readonly R16ReplayEntry[]):boolean{
    for(let i=1;i<entries.length;i++)if(entries[i]!.index<=entries[i-1]!.index||entries[i]!.tick<entries[i-1]!.tick)return false;
    return true;
  }
}
