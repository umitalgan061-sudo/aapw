/**
 * Acceptance matrix for the authored settlement vertical slice.
 * This records expected player-facing coverage without creating new gameplay
 * state. Tests can use it to ensure every authored episode remains playable.
 */
export const SETTLEMENT_EPISODE_VERTICAL_SLICE_ACCEPTANCE_VERSION=1;
export const SETTLEMENT_EPISODE_VERTICAL_SLICE_LIMITS=Object.freeze({episodes:6,requirements:10,text:180});
const REQUIREMENTS=Object.freeze(['enter','dialogue','objective','inventory','trade','craft','travel','survival','persistence','reward']);
const OPTIONAL=new Set(['trade','craft','travel','survival','persistence']);
const MATRIX=Object.freeze({
 iron_and_oath:Object.freeze({enter:'blacksmith',dialogue:'iron-01',objective:'iron-05',inventory:['iron-03','iron-04'],trade:null,craft:'iron-05',travel:null,survival:'iron-07',persistence:'iron-08',reward:'smithing_ledger'}),
 market_routes:Object.freeze({enter:'market',dialogue:'market-01',objective:'market-05',inventory:['market-02','market-03','market-07'],trade:'market-04',craft:null,travel:'market-06',survival:null,persistence:'market-08',reward:'merchant_ledger'}),
 road_watch:Object.freeze({enter:'barracks',dialogue:'watch-01',objective:'watch-04',inventory:['watch-03'],trade:null,craft:null,travel:'watch-05',survival:null,persistence:'watch-08',reward:'watcher'}),
 hearth_and_home:Object.freeze({enter:'house',dialogue:'home-04',objective:'home-03',inventory:['home-03','home-07'],trade:null,craft:null,travel:null,survival:'home-01',persistence:'home-02',reward:'keepsake'}),
 winter_supply:Object.freeze({enter:'farm',dialogue:'winter-01',objective:'winter-03',inventory:['winter-02','winter-03'],trade:'winter-05',craft:'winter-04',travel:'winter-07',survival:'winter-06',persistence:'winter-08',reward:'camp_cook'}),
 stable_master:Object.freeze({enter:'stable',dialogue:'stable-01',objective:'stable-04',inventory:['stable-02'],trade:'stable-02',craft:null,travel:'stable-05',survival:'stable-03',persistence:'stable-08',reward:'stable_hand'}),
});
const clone=(value)=>value==null?value:JSON.parse(JSON.stringify(value));
const freeze=(value)=>{if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;};
const text=(value,fallback='')=>{const v=String(value??'').trim();return v?v.slice(0,180):fallback;};
export function listSettlementEpisodeAcceptanceRequirements(){return [...REQUIREMENTS];}
export function listSettlementEpisodeAcceptanceEpisodes(){return Object.keys(MATRIX);}
export function getSettlementEpisodeAcceptance(episodeId){return MATRIX[episodeId]?clone(MATRIX[episodeId]):null;}
export function validateSettlementEpisodeAcceptance(){const errors=[];for(const episodeId of Object.keys(MATRIX)){const entry=MATRIX[episodeId];for(const requirement of REQUIREMENTS){if(!(requirement in entry))errors.push(`missing:${episodeId}:${requirement}`);}if(!entry.enter)errors.push(`enter:${episodeId}`);if(!entry.dialogue)errors.push(`dialogue:${episodeId}`);if(!entry.objective)errors.push(`objective:${episodeId}`);if(!entry.reward)errors.push(`reward:${episodeId}`);if(Array.isArray(entry.inventory)&&entry.inventory.length===0)errors.push(`inventory-empty:${episodeId}`);}
return{ok:errors.length===0,errors,episodeCount:Object.keys(MATRIX).length,requirementCount:REQUIREMENTS.length};}
export function buildSettlementEpisodeAcceptanceManifest(){return freeze({version:SETTLEMENT_EPISODE_VERTICAL_SLICE_ACCEPTANCE_VERSION,requirements:[...REQUIREMENTS],episodes:Object.keys(MATRIX).map((id)=>({episodeId:id,coverage:clone(MATRIX[id])})),validation:validateSettlementEpisodeAcceptance()});}
export function resolveSettlementEpisodeAcceptanceRequirement(episodeId,requirement){const entry=MATRIX[episodeId];if(!entry)return{ok:false,reason:'unknown-episode'};if(!REQUIREMENTS.includes(requirement))return{ok:false,reason:'unknown-requirement'};const value=entry[requirement];if(value==null){if(OPTIONAL.has(requirement))return freeze({ok:true,applicable:false,reason:'not-applicable',episodeId,requirement,value:null});return{ok:false,reason:'coverage-missing',episodeId,requirement};}if((Array.isArray(value)&&value.length===0)||value==='')return{ok:false,reason:'coverage-missing',episodeId,requirement};return freeze({ok:true,applicable:true,episodeId,requirement,value:clone(value),label:text(requirement)});}
export function buildSettlementEpisodeAcceptanceScore(episodeId){const entry=MATRIX[episodeId];if(!entry)return null;const results=REQUIREMENTS.map((requirement)=>resolveSettlementEpisodeAcceptanceRequirement(episodeId,requirement));const passed=results.filter((result)=>result.ok).length;const applicable=results.filter((result)=>result.applicable!==false).length;return freeze({episodeId,passed,total:REQUIREMENTS.length,applicable,percent:Math.round((passed/REQUIREMENTS.length)*100),results});}
export function buildSettlementEpisodeAcceptanceSummary(){const scores=listSettlementEpisodeAcceptanceEpisodes().map(buildSettlementEpisodeAcceptanceScore);const total=scores.reduce((sum,score)=>sum+score.total,0);const passed=scores.reduce((sum,score)=>sum+score.passed,0);const applicable=scores.reduce((sum,score)=>sum+score.applicable,0);return freeze({version:SETTLEMENT_EPISODE_VERTICAL_SLICE_ACCEPTANCE_VERSION,passed,total,applicable,percent:total?Math.round((passed/total)*100):0,episodes:scores});}
export function createSettlementEpisodeAcceptanceResolver(){const validation=validateSettlementEpisodeAcceptance();return Object.freeze({version:SETTLEMENT_EPISODE_VERTICAL_SLICE_ACCEPTANCE_VERSION,valid:validation.ok,validation:clone(validation),requirements:listSettlementEpisodeAcceptanceRequirements,episodes:listSettlementEpisodeAcceptanceEpisodes,get:getSettlementEpisodeAcceptance,resolve:resolveSettlementEpisodeAcceptanceRequirement,score:buildSettlementEpisodeAcceptanceScore,summary:buildSettlementEpisodeAcceptanceSummary,manifest:buildSettlementEpisodeAcceptanceManifest});}
