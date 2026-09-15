/**
 * Deterministic handoff contract for the six authored settlement episodes.
 *
 * This is a cross-system contract, not a second gameplay framework. It states
 * what the Episode Director hands to the existing SettlementCampaignRuntime:
 * service node, authored action, runtime action, presentation panel, and the
 * minimum input key expected by that existing owner.
 */
export const SETTLEMENT_EPISODE_HANDOFF_CONTRACT_VERSION = 1;
export const SETTLEMENT_EPISODE_HANDOFF_LIMITS = Object.freeze({ cases: 48, actions: 13, episodes: 6, text: 180 });

const CASES = Object.freeze([
  Object.freeze({ episodeId:'iron_and_oath', stepId:'iron-01', service:'blacksmith', action:'talk', runtimeAction:'talk', panel:'quests', inputKey:'nodeId', state:'dialogue' }),
  Object.freeze({ episodeId:'iron_and_oath', stepId:'iron-02', service:'blacksmith', action:'talk', runtimeAction:'talk', panel:'quests', inputKey:'nodeId', state:'dialogue' }),
  Object.freeze({ episodeId:'iron_and_oath', stepId:'iron-03', service:'blacksmith', action:'collect', runtimeAction:'interact', panel:'overview', inputKey:'nodeId', state:'inventory' }),
  Object.freeze({ episodeId:'iron_and_oath', stepId:'iron-04', service:'blacksmith', action:'collect', runtimeAction:'interact', panel:'overview', inputKey:'nodeId', state:'inventory' }),
  Object.freeze({ episodeId:'iron_and_oath', stepId:'iron-05', service:'blacksmith', action:'craft', runtimeAction:'craft', panel:'craft', inputKey:'recipeId', state:'crafting' }),
  Object.freeze({ episodeId:'iron_and_oath', stepId:'iron-06', service:'blacksmith', action:'equip', runtimeAction:'interact', panel:'craft', inputKey:'itemId', state:'equipment' }),
  Object.freeze({ episodeId:'iron_and_oath', stepId:'iron-07', service:'blacksmith', action:'rest', runtimeAction:'rest', panel:'overview', inputKey:'nodeId', state:'survival' }),
  Object.freeze({ episodeId:'iron_and_oath', stepId:'iron-08', service:'blacksmith', action:'talk', runtimeAction:'talk', panel:'quests', inputKey:'nodeId', state:'quest' }),

  Object.freeze({ episodeId:'market_routes', stepId:'market-01', service:'market', action:'talk', runtimeAction:'talk', panel:'quests', inputKey:'nodeId', state:'dialogue' }),
  Object.freeze({ episodeId:'market_routes', stepId:'market-02', service:'market', action:'buy', runtimeAction:'buy', panel:'trade', inputKey:'itemId', state:'economy' }),
  Object.freeze({ episodeId:'market_routes', stepId:'market-03', service:'market', action:'sell', runtimeAction:'sell', panel:'trade', inputKey:'itemId', state:'economy' }),
  Object.freeze({ episodeId:'market_routes', stepId:'market-04', service:'market', action:'trade', runtimeAction:'trade', panel:'trade', inputKey:'itemId', state:'economy' }),
  Object.freeze({ episodeId:'market_routes', stepId:'market-05', service:'market', action:'talk', runtimeAction:'talk', panel:'quests', inputKey:'nodeId', state:'dialogue' }),
  Object.freeze({ episodeId:'market_routes', stepId:'market-06', service:'gate', action:'travel', runtimeAction:'travel', panel:'travel', inputKey:'routeId', state:'travel' }),
  Object.freeze({ episodeId:'market_routes', stepId:'market-07', service:'market', action:'sell', runtimeAction:'sell', panel:'trade', inputKey:'itemId', state:'economy' }),
  Object.freeze({ episodeId:'market_routes', stepId:'market-08', service:'market', action:'talk', runtimeAction:'talk', panel:'quests', inputKey:'nodeId', state:'quest' }),

  Object.freeze({ episodeId:'road_watch', stepId:'watch-01', service:'barracks', action:'talk', runtimeAction:'talk', panel:'quests', inputKey:'nodeId', state:'dialogue' }),
  Object.freeze({ episodeId:'road_watch', stepId:'watch-02', service:'barracks', action:'train', runtimeAction:'train', panel:'overview', inputKey:'nodeId', state:'skill' }),
  Object.freeze({ episodeId:'road_watch', stepId:'watch-03', service:'barracks', action:'equip', runtimeAction:'interact', panel:'craft', inputKey:'itemId', state:'equipment' }),
  Object.freeze({ episodeId:'road_watch', stepId:'watch-04', service:'barracks', action:'talk', runtimeAction:'talk', panel:'quests', inputKey:'nodeId', state:'dialogue' }),
  Object.freeze({ episodeId:'road_watch', stepId:'watch-05', service:'gate', action:'travel', runtimeAction:'travel', panel:'travel', inputKey:'routeId', state:'travel' }),
  Object.freeze({ episodeId:'road_watch', stepId:'watch-06', service:'gate', action:'travel', runtimeAction:'travel', panel:'travel', inputKey:'routeId', state:'travel' }),
  Object.freeze({ episodeId:'road_watch', stepId:'watch-07', service:'barracks', action:'talk', runtimeAction:'talk', panel:'quests', inputKey:'nodeId', state:'quest' }),
  Object.freeze({ episodeId:'road_watch', stepId:'watch-08', service:'gate', action:'travel', runtimeAction:'travel', panel:'travel', inputKey:'routeId', state:'travel' }),

  Object.freeze({ episodeId:'hearth_and_home', stepId:'home-01', service:'house', action:'rest', runtimeAction:'rest', panel:'overview', inputKey:'nodeId', state:'survival' }),
  Object.freeze({ episodeId:'hearth_and_home', stepId:'home-02', service:'house', action:'save', runtimeAction:'save', panel:'overview', inputKey:'nodeId', state:'persistence' }),
  Object.freeze({ episodeId:'hearth_and_home', stepId:'home-03', service:'house', action:'interact', runtimeAction:'interact', panel:'overview', inputKey:'nodeId', state:'interior' }),
  Object.freeze({ episodeId:'hearth_and_home', stepId:'home-04', service:'house', action:'talk', runtimeAction:'talk', panel:'quests', inputKey:'nodeId', state:'dialogue' }),
  Object.freeze({ episodeId:'hearth_and_home', stepId:'home-05', service:'house', action:'rest', runtimeAction:'rest', panel:'overview', inputKey:'nodeId', state:'survival' }),
  Object.freeze({ episodeId:'hearth_and_home', stepId:'home-06', service:'house', action:'save', runtimeAction:'save', panel:'overview', inputKey:'nodeId', state:'persistence' }),
  Object.freeze({ episodeId:'hearth_and_home', stepId:'home-07', service:'house', action:'interact', runtimeAction:'interact', panel:'overview', inputKey:'nodeId', state:'interior' }),
  Object.freeze({ episodeId:'hearth_and_home', stepId:'home-08', service:'house', action:'talk', runtimeAction:'talk', panel:'quests', inputKey:'nodeId', state:'quest' }),

  Object.freeze({ episodeId:'winter_supply', stepId:'winter-01', service:'farm', action:'talk', runtimeAction:'talk', panel:'quests', inputKey:'nodeId', state:'dialogue' }),
  Object.freeze({ episodeId:'winter_supply', stepId:'winter-02', service:'farm', action:'collect', runtimeAction:'interact', panel:'overview', inputKey:'nodeId', state:'inventory' }),
  Object.freeze({ episodeId:'winter_supply', stepId:'winter-03', service:'farm', action:'collect', runtimeAction:'interact', panel:'overview', inputKey:'nodeId', state:'inventory' }),
  Object.freeze({ episodeId:'winter_supply', stepId:'winter-04', service:'farm', action:'craft', runtimeAction:'craft', panel:'craft', inputKey:'recipeId', state:'crafting' }),
  Object.freeze({ episodeId:'winter_supply', stepId:'winter-05', service:'farm', action:'trade', runtimeAction:'trade', panel:'trade', inputKey:'itemId', state:'economy' }),
  Object.freeze({ episodeId:'winter_supply', stepId:'winter-06', service:'farm', action:'rest', runtimeAction:'rest', panel:'overview', inputKey:'nodeId', state:'survival' }),
  Object.freeze({ episodeId:'winter_supply', stepId:'winter-07', service:'gate', action:'travel', runtimeAction:'travel', panel:'travel', inputKey:'routeId', state:'travel' }),
  Object.freeze({ episodeId:'winter_supply', stepId:'winter-08', service:'farm', action:'talk', runtimeAction:'talk', panel:'quests', inputKey:'nodeId', state:'quest' }),

  Object.freeze({ episodeId:'stable_master', stepId:'stable-01', service:'stable', action:'talk', runtimeAction:'talk', panel:'quests', inputKey:'nodeId', state:'dialogue' }),
  Object.freeze({ episodeId:'stable_master', stepId:'stable-02', service:'stable', action:'trade', runtimeAction:'trade', panel:'trade', inputKey:'itemId', state:'economy' }),
  Object.freeze({ episodeId:'stable_master', stepId:'stable-03', service:'stable', action:'rest', runtimeAction:'rest', panel:'overview', inputKey:'nodeId', state:'survival' }),
  Object.freeze({ episodeId:'stable_master', stepId:'stable-04', service:'stable', action:'talk', runtimeAction:'talk', panel:'quests', inputKey:'nodeId', state:'dialogue' }),
  Object.freeze({ episodeId:'stable_master', stepId:'stable-05', service:'gate', action:'travel', runtimeAction:'travel', panel:'travel', inputKey:'routeId', state:'travel' }),
  Object.freeze({ episodeId:'stable_master', stepId:'stable-06', service:'gate', action:'travel', runtimeAction:'travel', panel:'travel', inputKey:'routeId', state:'travel' }),
  Object.freeze({ episodeId:'stable_master', stepId:'stable-07', service:'stable', action:'talk', runtimeAction:'talk', panel:'quests', inputKey:'nodeId', state:'quest' }),
  Object.freeze({ episodeId:'stable_master', stepId:'stable-08', service:'gate', action:'travel', runtimeAction:'travel', panel:'travel', inputKey:'routeId', state:'travel' }),
]);

const clone=(value)=>value==null?value:JSON.parse(JSON.stringify(value));
const freeze=(value)=>{if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const nested of Object.values(value))freeze(nested);return value;};

export function listSettlementEpisodeHandoffCases(){return CASES.map((entry)=>entry.stepId);}
export function getSettlementEpisodeHandoffCase(stepId){const entry=CASES.find((value)=>value.stepId===stepId);return entry?clone(entry):null;}
export function getSettlementEpisodeHandoffCasesForEpisode(episodeId){return CASES.filter((entry)=>entry.episodeId===episodeId).map(clone);}
export function buildSettlementEpisodeHandoffManifest(){return freeze({version:SETTLEMENT_EPISODE_HANDOFF_CONTRACT_VERSION,limits:{...SETTLEMENT_EPISODE_HANDOFF_LIMITS},cases:clone(CASES)});}
export function validateSettlementEpisodeHandoffContract(){
  const errors=[];const seen=new Set();const episodes=new Set();const actions=new Set();
  for(const entry of CASES){
    if(seen.has(entry.stepId))errors.push(`duplicate:${entry.stepId}`);seen.add(entry.stepId);episodes.add(entry.episodeId);actions.add(entry.action);
    if(!entry.service)errors.push(`service:${entry.stepId}`);if(!entry.action)errors.push(`action:${entry.stepId}`);if(!entry.runtimeAction)errors.push(`runtime-action:${entry.stepId}`);if(!entry.panel)errors.push(`panel:${entry.stepId}`);if(!entry.inputKey)errors.push(`input-key:${entry.stepId}`);
    if(entry.action==='craft'&&entry.inputKey!=='recipeId')errors.push(`craft-input:${entry.stepId}`);if(entry.action==='travel'&&entry.inputKey!=='routeId')errors.push(`travel-input:${entry.stepId}`);if(['buy','sell','trade'].includes(entry.action)&&entry.inputKey!=='itemId')errors.push(`trade-input:${entry.stepId}`);if(entry.action==='equip'&&entry.inputKey!=='itemId')errors.push(`equip-input:${entry.stepId}`);
    if(['buy','sell','trade'].includes(entry.action)&&entry.panel!=='trade')errors.push(`trade-panel:${entry.stepId}`);if(entry.action==='craft'&&entry.panel!=='craft')errors.push(`craft-panel:${entry.stepId}`);if(entry.action==='travel'&&entry.panel!=='travel')errors.push(`travel-panel:${entry.stepId}`);if(entry.action==='talk'&&entry.panel!=='quests')errors.push(`talk-panel:${entry.stepId}`);
    if(entry.action==='collect'&&entry.runtimeAction!=='interact')errors.push(`collect-map:${entry.stepId}`);if(entry.action==='equip'&&entry.runtimeAction!=='interact')errors.push(`equip-map:${entry.stepId}`);
  }
  if(CASES.length!==SETTLEMENT_EPISODE_HANDOFF_LIMITS.cases)errors.push('case-count');if(episodes.size!==SETTLEMENT_EPISODE_HANDOFF_LIMITS.episodes)errors.push('episode-count');if(actions.size!==SETTLEMENT_EPISODE_HANDOFF_LIMITS.actions)errors.push('action-count');
  return{ok:errors.length===0,errors,caseCount:CASES.length,episodeCount:episodes.size,actionCount:actions.size};
}
export function resolveSettlementEpisodeHandoff(stepId,input={}){const entry=CASES.find((value)=>value.stepId===stepId);if(!entry)return{ok:false,reason:'unknown-step'};const source=input&&typeof input==='object'?input:{};const value=source[entry.inputKey]??(entry.inputKey==='nodeId'?entry.service:null);if(value==null||String(value).trim()==='')return{ok:false,reason:'required-input-missing',stepId,inputKey:entry.inputKey};return freeze({ok:true,stepId,episodeId:entry.episodeId,service:entry.service,action:entry.action,runtimeAction:entry.runtimeAction,panel:entry.panel,inputKey:entry.inputKey,state:entry.state,input:{...clone(source),[entry.inputKey]:String(value)}});}
