import { digestValue } from './deterministic.js';
import type { R16Result } from './types.js';
import { R16RuntimePlatform } from './runtime.js';

export interface R16PlatformSnapshot{
  readonly schema:'aapw-r16-platform';
  readonly version:16;
  readonly tick:number;
  readonly runtimeDigest:string;
  readonly diagnostics:Readonly<Record<string,unknown>>;
  readonly digest:string;
}

export class R16PlatformSnapshotter{
  capture(runtime:R16RuntimePlatform):R16PlatformSnapshot{
    const diagnostics=runtime.diagnostics();
    const body={schema:'aapw-r16-platform' as const,version:16 as const,tick:runtime.tick,runtimeDigest:runtime.digest().runtimeDigest,diagnostics};
    return Object.freeze({...body,digest:digestValue(body)});
  }
  verify(snapshot:R16PlatformSnapshot):R16Result<void>{
    const expected=digestValue({schema:snapshot.schema,version:snapshot.version,tick:snapshot.tick,runtimeDigest:snapshot.runtimeDigest,diagnostics:snapshot.diagnostics});
    return expected===snapshot.digest?{ok:true,value:undefined}:{ok:false,error:{code:'PLATFORM_SNAPSHOT_DIGEST',message:'Platform snapshot integrity mismatch',retryable:false}};
  }
  compare(left:R16PlatformSnapshot,right:R16PlatformSnapshot):Readonly<{equal:boolean;digest:string}>{
    const equal=left.runtimeDigest===right.runtimeDigest;
    return Object.freeze({equal,digest:digestValue({left:left.runtimeDigest,right:right.runtimeDigest})});
  }
}
