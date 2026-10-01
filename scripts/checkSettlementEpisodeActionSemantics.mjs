import { strict as assert } from 'node:assert';
import { createSettlementEpisodeDirector } from '../src/3d/gameplay/settlementEpisodeDirector.js';
import { buildSettlementEpisodePresentation } from '../src/3d/gameplay/settlementEpisodePresentationModel.js';
import { getSettlementEpisode, getSettlementEpisodeBeat } from '../src/3d/gameplay/settlementEpisodeContent.js';

let checks=0;
const ok=(v,m)=>{assert.ok(v,m);checks+=1;};
const eq=(a,b,m)=>{assert.equal(a,b,m);checks+=1;};
function runtime(){
  let state={activeService:null,panel:'overview',route:[],history:[],feedback:null,lastAction:null};
  return {
    open(service,panel){state={...state,activeService:service,panel};return{ok:true,view:{...state}};},
    close(){state={...state,activeService:null,panel:'overview'};return{ok:true,view:{...state}};},
    async execute(action,input){state={...state,lastAction:{action,nodeId:input.nodeId,episodeId:input.episodeId,episodeStepId:input.episodeStepId},history:[...state.history,{type:'action',action}],feedback:{status:'success',code:'ok',message:'Tamamlandı.'}};return{ok:true,action,nodeId:input.nodeId,view:{...state}};},
    view(){return{...state};}
  };
}

const iron_and_oath_beats=[
 ['iron-01','talk','blacksmith'],
 ['iron-02','talk','blacksmith'],
 ['iron-03','collect','blacksmith'],
 ['iron-04','collect','blacksmith'],
 ['iron-05','craft','blacksmith'],
 ['iron-06','equip','blacksmith'],
 ['iron-07','rest','blacksmith'],
 ['iron-08','talk','blacksmith'],
];
const market_routes_beats=[
 ['market-01','talk','market'],
 ['market-02','buy','market'],
 ['market-03','sell','market'],
 ['market-04','trade','market'],
 ['market-05','talk','market'],
 ['market-06','travel','gate'],
 ['market-07','sell','market'],
 ['market-08','talk','market'],
];
const road_watch_beats=[
 ['watch-01','talk','barracks'],
 ['watch-02','train','barracks'],
 ['watch-03','equip','barracks'],
 ['watch-04','talk','barracks'],
 ['watch-05','travel','gate'],
 ['watch-06','travel','gate'],
 ['watch-07','talk','barracks'],
 ['watch-08','travel','gate'],
];
const hearth_and_home_beats=[
 ['home-01','rest','house'],
 ['home-02','save','house'],
 ['home-03','interact','house'],
 ['home-04','talk','house'],
 ['home-05','rest','house'],
 ['home-06','save','house'],
 ['home-07','interact','house'],
 ['home-08','talk','house'],
];
const winter_supply_beats=[
 ['winter-01','talk','farm'],
 ['winter-02','collect','farm'],
 ['winter-03','collect','farm'],
 ['winter-04','craft','farm'],
 ['winter-05','trade','farm'],
 ['winter-06','rest','farm'],
 ['winter-07','travel','gate'],
 ['winter-08','talk','farm'],
];
const stable_master_beats=[
 ['stable-01','talk','stable'],
 ['stable-02','trade','stable'],
 ['stable-03','rest','stable'],
 ['stable-04','talk','stable'],
 ['stable-05','travel','gate'],
 ['stable-06','travel','gate'],
 ['stable-07','talk','stable'],
 ['stable-08','travel','gate'],
];

const cases=[
 ['iron_and_oath',iron_and_oath_beats],
 ['market_routes',market_routes_beats],
 ['road_watch',road_watch_beats],
 ['hearth_and_home',hearth_and_home_beats],
 ['winter_supply',winter_supply_beats],
 ['stable_master',stable_master_beats],
];

for(const [episodeId,beats] of cases){
  const runtime=runtime();
  const director=createSettlementEpisodeDirector({runtime,now:()=>500});
  const opened=director.openEpisode(episodeId);
  ok(opened.ok,`open:${episodeId}`);
  eq(opened.view.episodeId,episodeId,`episode:${episodeId}`);
  eq(opened.view.cursor,0,`cursor-start:${episodeId}`);
  for(let index=0;index<beats.length;index+=1){
    const [stepId,action,service]=beats[index];
    const beat=getSettlementEpisodeBeat(episodeId,stepId);
    ok(beat,`beat:${stepId}`);
    eq(beat.action,action,`action:${stepId}`);
    eq(beat.service,service,`service:${stepId}`);
    const moved=director.setCursor(index);
    ok(moved.ok,`cursor-set:${stepId}`);
    eq(director.snapshot().cursor,index,`cursor-read:${stepId}`);
    const prepared=director.prepareCurrent({});
    eq(prepared.stepId,stepId,`prepared-step:${stepId}`);
    eq(prepared.action,action,`prepared-action:${stepId}`);
    eq(prepared.service,service,`prepared-service:${stepId}`);
    ok(prepared.input.nodeId,`node:${stepId}`);
    const model=buildSettlementEpisodePresentation(director.snapshot());
    eq(model.primary.id,stepId,`ux-id:${stepId}`);
    eq(model.primary.action.id,action,`ux-action:${stepId}`);
    eq(model.primary.service.id,service,`ux-service:${stepId}`);
    ok(model.primary.prompt.length>0,`ux-prompt:${stepId}`);
    eq(model.primary.hints.length,3,`ux-hints:${stepId}`);
    eq(model.cards.length,8,`ux-cards:${stepId}`);
    ok(model.actions.length>=1,`ux-actions:${stepId}`);
  }
}

const mapping=[
 ['talk','talk'],
 ['collect','interact'],
 ['deliver','interact'],
 ['craft','craft'],
 ['travel','travel'],
 ['trade','trade'],
 ['buy','buy'],
 ['sell','sell'],
 ['equip','interact'],
 ['rest','rest'],
 ['train','train'],
 ['save','save'],
 ['interact','interact'],
];
for(const [action,runtimeAction] of mapping){
  const source=action==='travel'?'market_routes':action==='craft'?'iron_and_oath':action==='save'?'hearth_and_home':'market_routes';
  const d=createSettlementEpisodeDirector({runtime:runtime()});
  d.openEpisode(source);
  const episode=d.snapshot().episode;
  const index=episode.beats.findIndex((beat)=>beat.action===action);
  if(index<0)continue;
  d.setCursor(index);
  eq(d.prepareCurrent().runtimeAction,runtimeAction,`runtime-map:${action}`);
}

for(const id of ['iron_and_oath','market_routes','road_watch','hearth_and_home','winter_supply','stable_master']){
  const d=createSettlementEpisodeDirector({runtime:runtime()});
  d.openEpisode(id);
  const episode=d.snapshot().episode;
  eq(episode.beats.length,8,`episode-eight:${id}`);
  eq(new Set(episode.beats.map((beat)=>beat.stepId)).size,8,`unique-steps:${id}`);
  ok(episode.beats.every((beat)=>Array.isArray(beat.hints)&&beat.hints.length===3),`hints-complete:${id}`);
  ok(episode.beats.every((beat)=>beat.ux?.showObjective===true),`objective-ux:${id}`);
  ok(episode.beats.every((beat)=>beat.ux?.showService===true),`service-ux:${id}`);
}

console.log(`SETTLEMENT_EPISODE_ACTION_SEMANTICS_OK checks=${checks}`);
