export interface IntelligenceArchitectureMap { readonly layers: readonly { readonly name:string; readonly responsibility:string; readonly authority:string; readonly input:string; readonly output:string; }[]; readonly invariants: readonly string[]; }
export const ARCHITECTURE_MAP:IntelligenceArchitectureMap=Object.freeze({layers:Object.freeze([
 {name:'snapshot',responsibility:'immutable world and actor inputs',authority:'caller-owned gameplay state',input:'actor/world snapshots',output:'typed immutable observations'},
 {name:'perception',responsibility:'sensor fusion and confidence',authority:'intelligence perception policy',input:'stimuli and optional occlusion probe',output:'perceived stimuli and memories'},
 {name:'utility',responsibility:'goal scoring',authority:'goal definitions and utility curves',input:'decision context',output:'ranked utility scores'},
 {name:'decision',responsibility:'intent selection and commit arbitration',authority:'decision policy',input:'utility scores and danger estimate',output:'immutable intents'},
 {name:'interest',responsibility:'context prioritisation',authority:'interest policy',input:'world points and events',output:'bounded interest candidates'},
 {name:'events',responsibility:'world event journal',authority:'event policy',input:'typed world events',output:'deduplicated retained events'},
 {name:'quests',responsibility:'objective progression',authority:'quest graph',input:'world events',output:'immutable quest instances'},
 {name:'encounters',responsibility:'encounter candidate scoring',authority:'encounter definitions',input:'biome/faction/danger context',output:'bounded encounter candidates'},
 {name:'runtime',responsibility:'orchestration and budgets',authority:'tick boundary',input:'all typed snapshots',output:'metrics decisions interests'},
 {name:'validation',responsibility:'release acceptance',authority:'validation gates',input:'runtime outputs',output:'deterministic evidence'}
]),invariants:Object.freeze(['no subsystem mutates caller-owned gameplay state','all ranking uses stable tie-breakers','all untrusted numbers are bounded','all public snapshots are immutable','all hot collections have explicit caps','disposed components fail closed','event identifiers are deduplicated','replay output is sorted before hashing'])});
