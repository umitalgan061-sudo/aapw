import type { ActorSnapshot, FactionProfile, GoalDefinition, GoalKind, StimulusKind } from './types.js';
import type { IntelligenceConfig } from './types.js';

export interface ActorArchetype {
 readonly id:string;readonly displayName:string;readonly faction:string;readonly preferredGoals:readonly GoalKind[];readonly sensoryBias:Readonly<Record<StimulusKind,number>>;readonly combatReadiness:number;readonly sociability:number;readonly bravery:number;readonly mobility:number;readonly memoryRetention:number;
}
export interface WorldProfile {readonly id:string;readonly biome:string;readonly danger:number;readonly visibility:number;readonly acousticRange:number;readonly resourceRichness:number;readonly populationCap:number;readonly preferredWeather:readonly string[];readonly tags:readonly string[];}
export interface TuningProfile {readonly id:string;readonly archetype:string;readonly world:string;readonly perceptionScale:number;readonly decisionScale:number;readonly eventScale:number;readonly interestScale:number;readonly questScale:number;}

const goals=(...items:GoalKind[]):readonly GoalKind[]=>Object.freeze(items);
const senses=(visual:number,audio:number,damage:number,death:number,movement:number,interaction:number,resource:number,weather:number,faction:number):Readonly<Record<StimulusKind,number>>=>Object.freeze({visual,audio,damage,death,movement,interaction,resource,weather,faction});

export const ACTOR_ARCHETYPES:readonly ActorArchetype[] = Object.freeze([
 {id:'guardian-01',displayName:'Stone Sentinel',faction:'wardens',preferredGoals:goals('protect','patrol','survive'),sensoryBias:senses(1,.7,1,1,.6,.5,.4,.3,.9),combatReadiness:.92,sociability:.45,bravery:.96,mobility:.4,memoryRetention:.92},
 {id:'guardian-02',displayName:'Gate Sentinel',faction:'wardens',preferredGoals:goals('protect','patrol','assist'),sensoryBias:senses(1,.8,1,1,.7,.5,.3,.3,1),combatReadiness:.95,sociability:.5,bravery:.98,mobility:.38,memoryRetention:.95},
 {id:'guardian-03',displayName:'Ridge Watcher',faction:'wardens',preferredGoals:goals('patrol','investigate','protect'),sensoryBias:senses(1,.9,.9,.9,.8,.4,.3,.5,.8),combatReadiness:.88,sociability:.35,bravery:.94,mobility:.68,memoryRetention:.9},
 {id:'guardian-04',displayName:'River Watcher',faction:'wardens',preferredGoals:goals('patrol','protect','investigate'),sensoryBias:senses(.9,1,.9,.9,.8,.6,.5,.7,.8),combatReadiness:.84,sociability:.4,bravery:.9,mobility:.62,memoryRetention:.88},
 {id:'guardian-05',displayName:'Night Sentinel',faction:'wardens',preferredGoals:goals('protect','survive','investigate'),sensoryBias:senses(.8,1,1,1,.8,.4,.2,.4,.9),combatReadiness:.96,sociability:.3,bravery:.97,mobility:.52,memoryRetention:.97},
 {id:'guardian-06',displayName:'Road Marshal',faction:'wardens',preferredGoals:goals('patrol','assist','protect'),sensoryBias:senses(.95,.8,.9,.8,.85,.7,.4,.4,.95),combatReadiness:.86,sociability:.72,bravery:.9,mobility:.72,memoryRetention:.82},
 {id:'guardian-07',displayName:'Marsh Warden',faction:'wardens',preferredGoals:goals('investigate','protect','survive'),sensoryBias:senses(.9,1,1,.9,.7,.4,.6,.8,.7),combatReadiness:.8,sociability:.3,bravery:.86,mobility:.55,memoryRetention:.93},
 {id:'guardian-08',displayName:'Citadel Captain',faction:'wardens',preferredGoals:goals('protect','assist','patrol'),sensoryBias:senses(1,.9,1,1,.8,.8,.3,.4,1),combatReadiness:1,sociability:.8,bravery:1,mobility:.58,memoryRetention:.96},
 {id:'hunter-01',displayName:'Pine Tracker',faction:'hunters',preferredGoals:goals('hunt','gather','patrol'),sensoryBias:senses(1,1,.8,.8,1,.5,.8,.5,.5),combatReadiness:.82,sociability:.45,bravery:.82,mobility:.9,memoryRetention:.95},
 {id:'hunter-02',displayName:'Cliff Stalker',faction:'hunters',preferredGoals:goals('hunt','survive','travel'),sensoryBias:senses(1,.9,.8,.9,1,.3,.4,.6,.4),combatReadiness:.9,sociability:.25,bravery:.88,mobility:.98,memoryRetention:.9},
 {id:'hunter-03',displayName:'Marsh Tracker',faction:'hunters',preferredGoals:goals('hunt','investigate','gather'),sensoryBias:senses(.95,1,.85,.9,.95,.4,.9,.8,.3),combatReadiness:.8,sociability:.3,bravery:.8,mobility:.72,memoryRetention:.97},
 {id:'hunter-04',displayName:'Falcon Scout',faction:'hunters',preferredGoals:goals('investigate','patrol','hunt'),sensoryBias:senses(1,.85,.7,.8,1,.45,.5,.45,.4),combatReadiness:.7,sociability:.5,bravery:.74,mobility:1,memoryRetention:.86},
 {id:'hunter-05',displayName:'Boar Spear',faction:'hunters',preferredGoals:goals('hunt','survive','protect'),sensoryBias:senses(.85,.95,1,1,.9,.3,.4,.35,.35),combatReadiness:.96,sociability:.35,bravery:.99,mobility:.75,memoryRetention:.9},
 {id:'hunter-06',displayName:'Trail Keeper',faction:'hunters',preferredGoals:goals('patrol','travel','gather'),sensoryBias:senses(.9,1,.8,.8,.95,.8,.7,.5,.5),combatReadiness:.68,sociability:.65,bravery:.7,mobility:.88,memoryRetention:.91},
 {id:'hunter-07',displayName:'Moon Archer',faction:'hunters',preferredGoals:goals('hunt','patrol','survive'),sensoryBias:senses(1,1,.9,1,.85,.3,.3,.3,.6),combatReadiness:.93,sociability:.2,bravery:.9,mobility:.82,memoryRetention:.98},
 {id:'hunter-08',displayName:'Beast Whisperer',faction:'hunters',preferredGoals:goals('gather','assist','protect'),sensoryBias:senses(.85,1,.6,.7,.9,1,1,.7,.5),combatReadiness:.55,sociability:.92,bravery:.68,mobility:.8,memoryRetention:.94},
 {id:'merchant-01',displayName:'Caravan Broker',faction:'traders',preferredGoals:goals('travel','gather','assist'),sensoryBias:senses(.85,.9,.5,.5,.75,1,1,.7,.9),combatReadiness:.3,sociability:.96,bravery:.42,mobility:.86,memoryRetention:.82},
 {id:'merchant-02',displayName:'River Trader',faction:'traders',preferredGoals:goals('travel','gather','rest'),sensoryBias:senses(.8,1,.5,.5,.7,1,1,.9,.85),combatReadiness:.25,sociability:.98,bravery:.35,mobility:.8,memoryRetention:.78},
 {id:'merchant-03',displayName:'Blacksmith',faction:'traders',preferredGoals:goals('gather','assist','rest'),sensoryBias:senses(.7,.8,.7,.6,.5,1,1,.2,.7),combatReadiness:.72,sociability:.8,bravery:.74,mobility:.42,memoryRetention:.86},
 {id:'merchant-04',displayName:'Herbalist',faction:'traders',preferredGoals:goals('gather','assist','rest'),sensoryBias:senses(.9,.85,.3,.4,.7,1,1,1,.4),combatReadiness:.25,sociability:.9,bravery:.28,mobility:.58,memoryRetention:.97},
 {id:'merchant-05',displayName:'Relic Dealer',faction:'traders',preferredGoals:goals('gather','investigate','travel'),sensoryBias:senses(1,.7,.4,.5,.5,1,1,.5,.8),combatReadiness:.2,sociability:.86,bravery:.32,mobility:.74,memoryRetention:.95},
 {id:'merchant-06',displayName:'Quartermaster',faction:'traders',preferredGoals:goals('gather','protect','assist'),sensoryBias:senses(.8,.8,.75,.75,.6,1,1,.4,.92),combatReadiness:.62,sociability:.74,bravery:.66,mobility:.5,memoryRetention:.9},
 {id:'merchant-07',displayName:'Wayfarer',faction:'traders',preferredGoals:goals('travel','investigate','gather'),sensoryBias:senses(.9,.95,.5,.5,.85,.9,.75,.65,.7),combatReadiness:.4,sociability:.82,bravery:.55,mobility:.94,memoryRetention:.83},
 {id:'merchant-08',displayName:'Market Elder',faction:'traders',preferredGoals:goals('assist','rest','protect'),sensoryBias:senses(.75,.9,.55,.55,.45,1,1,.4,1),combatReadiness:.35,sociability:1,bravery:.48,mobility:.28,memoryRetention:1},
 {id:'scholar-01',displayName:'Field Scholar',faction:'scholars',preferredGoals:goals('investigate','gather','travel'),sensoryBias:senses(1,1,.3,.4,.7,1,1,1,.95),combatReadiness:.18,sociability:.82,bravery:.24,mobility:.62,memoryRetention:1},
 {id:'scholar-02',displayName:'Ruins Cartographer',faction:'scholars',preferredGoals:goals('investigate','travel','survive'),sensoryBias:senses(1,.85,.5,.55,1,.8,.7,.7,.9),combatReadiness:.32,sociability:.58,bravery:.42,mobility:.95,memoryRetention:.98},
 {id:'scholar-03',displayName:'Storm Researcher',faction:'scholars',preferredGoals:goals('investigate','rest','gather'),sensoryBias:senses(.8,1,.25,.3,.4,1,.8,1,1),combatReadiness:.12,sociability:.76,bravery:.3,mobility:.38,memoryRetention:.99},
 {id:'scholar-04',displayName:'Relic Linguist',faction:'scholars',preferredGoals:goals('investigate','assist','travel'),sensoryBias:senses(1,.85,.2,.2,.5,1,1,.5,.95),combatReadiness:.08,sociability:.88,bravery:.2,mobility:.5,memoryRetention:1},
 {id:'scholar-05',displayName:'Bestiary Keeper',faction:'scholars',preferredGoals:goals('investigate','protect','assist'),sensoryBias:senses(.95,1,.45,.6,.9,1,1,.8,.8),combatReadiness:.3,sociability:.84,bravery:.4,mobility:.66,memoryRetention:.99},
 {id:'scholar-06',displayName:'Astral Observer',faction:'scholars',preferredGoals:goals('investigate','rest','travel'),sensoryBias:senses(.7,.95,.2,.2,.35,1,.4,1,1),combatReadiness:.05,sociability:.64,bravery:.17,mobility:.25,memoryRetention:1},
 {id:'scholar-07',displayName:'Archive Warden',faction:'scholars',preferredGoals:goals('protect','investigate','assist'),sensoryBias:senses(.9,.9,.8,.7,.6,1,.8,.4,1),combatReadiness:.7,sociability:.7,bravery:.8,mobility:.32,memoryRetention:1},
 {id:'scholar-08',displayName:'Natural Philosopher',faction:'scholars',preferredGoals:goals('gather','investigate','assist'),sensoryBias:senses(.95,1,.25,.35,.85,1,1,1,.82),combatReadiness:.16,sociability:.9,bravery:.26,mobility:.55,memoryRetention:1},
 {id:'nomad-01',displayName:'Dune Runner',faction:'nomads',preferredGoals:goals('travel','survive','gather'),sensoryBias:senses(1,.85,.75,.8,1,.65,.85,.9,.4),combatReadiness:.72,sociability:.58,bravery:.76,mobility:1,memoryRetention:.86},
 {id:'nomad-02',displayName:'Steppe Guide',faction:'nomads',preferredGoals:goals('travel','assist','patrol'),sensoryBias:senses(1,.9,.7,.7,.95,.9,.7,.8,.5),combatReadiness:.55,sociability:.88,bravery:.67,mobility:.96,memoryRetention:.83},
 {id:'nomad-03',displayName:'Salt Walker',faction:'nomads',preferredGoals:goals('gather','travel','survive'),sensoryBias:senses(.95,.8,.8,.8,.9,.5,1,1,.3),combatReadiness:.68,sociability:.35,bravery:.72,mobility:.91,memoryRetention:.89},
 {id:'nomad-04',displayName:'Star Pilgrim',faction:'nomads',preferredGoals:goals('travel','investigate','rest'),sensoryBias:senses(.75,.8,.3,.3,.85,1,.3,1,.95),combatReadiness:.2,sociability:.82,bravery:.4,mobility:.9,memoryRetention:.98},
 {id:'nomad-05',displayName:'Mountain Caravaner',faction:'nomads',preferredGoals:goals('travel','gather','protect'),sensoryBias:senses(.95,.9,.9,.9,1,.8,.8,.8,.6),combatReadiness:.8,sociability:.72,bravery:.88,mobility:.8,memoryRetention:.9},
 {id:'nomad-06',displayName:'Frost Herder',faction:'nomads',preferredGoals:goals('gather','protect','survive'),sensoryBias:senses(.8,1,.85,.9,.75,.8,1,1,.6),combatReadiness:.74,sociability:.76,bravery:.82,mobility:.65,memoryRetention:.94},
 {id:'nomad-07',displayName:'Canyon Runner',faction:'nomads',preferredGoals:goals('travel','hunt','patrol'),sensoryBias:senses(1,.95,.9,.8,1,.4,.4,.6,.3),combatReadiness:.84,sociability:.4,bravery:.9,mobility:1,memoryRetention:.87},
 {id:'nomad-08',displayName:'Camp Elder',faction:'nomads',preferredGoals:goals('protect','assist','rest'),sensoryBias:senses(.8,.95,.8,.9,.5,1,.8,.8,1),combatReadiness:.65,sociability:.97,bravery:.74,mobility:.28,memoryRetention:1},
 {id:'raider-01',displayName:'Ash Raider',faction:'raiders',preferredGoals:goals('hunt','flee','survive'),sensoryBias:senses(.85,.9,1,1,.9,.25,.2,.4,.6),combatReadiness:.95,sociability:.28,bravery:.9,mobility:.88,memoryRetention:.82},
 {id:'raider-02',displayName:'Night Raider',faction:'raiders',preferredGoals:goals('hunt','travel','flee'),sensoryBias:senses(1,1,1,1,.95,.2,.1,.3,.55),combatReadiness:.98,sociability:.2,bravery:.88,mobility:.94,memoryRetention:.78},
 {id:'raider-03',displayName:'Wolf Marauder',faction:'raiders',preferredGoals:goals('hunt','survive','patrol'),sensoryBias:senses(.9,1,1,1,.95,.2,.2,.3,.5),combatReadiness:1,sociability:.18,bravery:1,mobility:.9,memoryRetention:.84},
 {id:'raider-04',displayName:'Firestarter',faction:'raiders',preferredGoals:goals('hunt','investigate','flee'),sensoryBias:senses(.95,.95,.8,.9,.85,.35,.2,.9,.4),combatReadiness:.88,sociability:.3,bravery:.82,mobility:.72,memoryRetention:.76},
 {id:'raider-05',displayName:'Fence Breaker',faction:'raiders',preferredGoals:goals('hunt','protect','survive'),sensoryBias:senses(.8,.85,1,1,.7,.2,.1,.2,.6),combatReadiness:1,sociability:.15,bravery:1,mobility:.5,memoryRetention:.8},
 {id:'raider-06',displayName:'Spoiler Scout',faction:'raiders',preferredGoals:goals('investigate','hunt','travel'),sensoryBias:senses(1,1,.8,.8,1,.3,.2,.5,.7),combatReadiness:.78,sociability:.35,bravery:.76,mobility:.98,memoryRetention:.9},
 {id:'raider-07',displayName:'War Caller',faction:'raiders',preferredGoals:goals('hunt','protect','assist'),sensoryBias:senses(.9,1,1,1,.75,1,.1,.4,1),combatReadiness:.96,sociability:.84,bravery:.98,mobility:.45,memoryRetention:.93},
 {id:'raider-08',displayName:'Grave Robber',faction:'raiders',preferredGoals:goals('gather','flee','travel'),sensoryBias:senses(1,.8,.3,.5,.7,1,1,.4,.2),combatReadiness:.42,sociability:.25,bravery:.3,mobility:.78,memoryRetention:.7},
 {id:'beast-01',displayName:'Ridge Wolf',faction:'wildlife',preferredGoals:goals('hunt','survive','flee'),sensoryBias:senses(.9,1,1,1,1,.1,.7,.8,.4),combatReadiness:.88,sociability:.35,bravery:.8,mobility:1,memoryRetention:.75},
 {id:'beast-02',displayName:'Cave Bear',faction:'wildlife',preferredGoals:goals('survive','protect','rest'),sensoryBias:senses(.7,.9,1,1,.6,.1,.8,.5,.2),combatReadiness:.94,sociability:.12,bravery:.92,mobility:.38,memoryRetention:.7},
 {id:'beast-03',displayName:'Marsh Crocodile',faction:'wildlife',preferredGoals:goals('hunt','rest','survive'),sensoryBias:senses(.8,1,1,1,.55,.1,.7,1,.1),combatReadiness:.91,sociability:.05,bravery:.9,mobility:.4,memoryRetention:.82},
 {id:'beast-04',displayName:'Highland Eagle',faction:'wildlife',preferredGoals:goals('hunt','travel','patrol'),sensoryBias:senses(1,1,.9,.9,1,.05,.5,1,.2),combatReadiness:.72,sociability:.22,bravery:.84,mobility:1,memoryRetention:.8},
 {id:'beast-05',displayName:'Forest Elk',faction:'wildlife',preferredGoals:goals('gather','flee','travel'),sensoryBias:senses(1,1,.8,1,1,.1,1,.8,.2),combatReadiness:.3,sociability:.7,bravery:.35,mobility:.92,memoryRetention:.86},
 {id:'beast-06',displayName:'River Otter',faction:'wildlife',preferredGoals:goals('gather','travel','rest'),sensoryBias:senses(.9,1,.5,.6,1,.25,1,1,.2),combatReadiness:.18,sociability:.92,bravery:.28,mobility:.96,memoryRetention:.68},
 {id:'beast-07',displayName:'Snow Lynx',faction:'wildlife',preferredGoals:goals('hunt','flee','travel'),sensoryBias:senses(1,1,.9,1,1,.05,.4,1,.15),combatReadiness:.85,sociability:.08,bravery:.64,mobility:.99,memoryRetention:.9},
 {id:'beast-08',displayName:'Coastal Drake',faction:'wildlife',preferredGoals:goals('hunt','travel','protect'),sensoryBias:senses(1,.95,1,1,1,.05,.5,1,.2),combatReadiness:1,sociability:.12,bravery:1,mobility:.95,memoryRetention:.93},
]);

export const WORLD_PROFILES:readonly WorldProfile[] = Object.freeze([
 {id:'highland-spring',biome:'highland',danger:.3,visibility:.86,acousticRange:1,resourceRichness:.62,populationCap:80,preferredWeather:['clear','windy'],tags:['grass','rock','ridge']},
 {id:'highland-storm',biome:'highland',danger:.58,visibility:.42,acousticRange:.65,resourceRichness:.55,populationCap:62,preferredWeather:['storm','rain'],tags:['grass','rock','storm']},
 {id:'pine-autumn',biome:'forest',danger:.44,visibility:.58,acousticRange:.82,resourceRichness:.82,populationCap:120,preferredWeather:['mist','rain'],tags:['pine','forest','leaf']},
 {id:'pine-night',biome:'forest',danger:.65,visibility:.28,acousticRange:1,resourceRichness:.7,populationCap:95,preferredWeather:['clear','mist'],tags:['pine','night','forest']},
 {id:'marsh-dawn',biome:'marsh',danger:.52,visibility:.48,acousticRange:.92,resourceRichness:.76,populationCap:72,preferredWeather:['mist','rain'],tags:['water','marsh','reeds']},
 {id:'marsh-fog',biome:'marsh',danger:.7,visibility:.18,acousticRange:.75,resourceRichness:.68,populationCap:54,preferredWeather:['mist'],tags:['water','fog','marsh']},
 {id:'river-summer',biome:'river',danger:.34,visibility:.9,acousticRange:.9,resourceRichness:.88,populationCap:110,preferredWeather:['clear','hot'],tags:['river','fish','grass']},
 {id:'river-flood',biome:'river',danger:.67,visibility:.55,acousticRange:.72,resourceRichness:.93,populationCap:76,preferredWeather:['rain','storm'],tags:['river','flood','mud']},
 {id:'canyon-dry',biome:'canyon',danger:.61,visibility:.95,acousticRange:.88,resourceRichness:.24,populationCap:45,preferredWeather:['hot','windy'],tags:['rock','dust','canyon']},
 {id:'canyon-dusk',biome:'canyon',danger:.73,visibility:.5,acousticRange:1,resourceRichness:.2,populationCap:36,preferredWeather:['clear'],tags:['rock','dusk','canyon']},
 {id:'coast-calm',biome:'coast',danger:.27,visibility:.92,acousticRange:.7,resourceRichness:.74,populationCap:92,preferredWeather:['clear','windy'],tags:['shore','water','sand']},
 {id:'coast-gale',biome:'coast',danger:.63,visibility:.62,acousticRange:.46,resourceRichness:.7,populationCap:58,preferredWeather:['windy','storm'],tags:['shore','wind','spray']},
 {id:'snow-pine',biome:'snowforest',danger:.58,visibility:.63,acousticRange:.86,resourceRichness:.42,populationCap:60,preferredWeather:['snow','clear'],tags:['snow','pine','cold']},
 {id:'snow-blizzard',biome:'tundra',danger:.87,visibility:.08,acousticRange:.35,resourceRichness:.18,populationCap:24,preferredWeather:['blizzard','snow'],tags:['snow','ice','whiteout']},
 {id:'cave-deep',biome:'cave',danger:.81,visibility:.12,acousticRange:1.1,resourceRichness:.52,populationCap:38,preferredWeather:['clear'],tags:['cave','dark','stone']},
 {id:'cave-lake',biome:'cave',danger:.66,visibility:.18,acousticRange:1.2,resourceRichness:.61,populationCap:46,preferredWeather:['mist'],tags:['cave','water','echo']},
 {id:'steppe-day',biome:'steppe',danger:.36,visibility:.96,acousticRange:.93,resourceRichness:.48,populationCap:74,preferredWeather:['clear','windy'],tags:['grass','open','steppe']},
 {id:'steppe-night',biome:'steppe',danger:.64,visibility:.38,acousticRange:1,resourceRichness:.4,populationCap:51,preferredWeather:['clear'],tags:['grass','night','open']},
 {id:'desert-dune',biome:'desert',danger:.72,visibility:.97,acousticRange:.82,resourceRichness:.15,populationCap:30,preferredWeather:['hot','windy'],tags:['sand','desert','dune']},
 {id:'desert-sandstorm',biome:'desert',danger:.9,visibility:.06,acousticRange:.3,resourceRichness:.08,populationCap:18,preferredWeather:['sandstorm'],tags:['sand','storm','desert']},
]);

export const TUNING_PROFILES:readonly TuningProfile[] = Object.freeze(WORLD_PROFILES.flatMap(world=>ACTOR_ARCHETYPES.slice(0,8).map(actor=>Object.freeze({id:`${actor.id}:${world.id}`,archetype:actor.id,world:world.id,perceptionScale:0.75+world.visibility*.4,decisionScale:0.85+world.danger*.3,eventScale:0.8+world.acousticRange*.2,interestScale:0.7+world.resourceRichness*.4,questScale:0.8+actor.sociability*.25}))));

export function findArchetype(id:string):ActorArchetype|undefined{return ACTOR_ARCHETYPES.find(a=>a.id===id);}
export function findWorldProfile(id:string):WorldProfile|undefined{return WORLD_PROFILES.find(w=>w.id===id);}
export function createFactionFromArchetype(archetype:ActorArchetype):FactionProfile{return Object.freeze({id:archetype.faction,name:archetype.faction,power:archetype.combatReadiness*100,territoryTags:[],relations:{},preferredGoals:archetype.preferredGoals,hostileTags:[]});}
export function applyArchetype(actor:ActorSnapshot,archetype:ActorArchetype):ActorSnapshot{return Object.freeze({...actor,stamina:Math.min(actor.maxStamina,actor.stamina+(actor.maxStamina*.1*archetype.mobility))});}
export function recommendedConfig(world:WorldProfile):Partial<IntelligenceConfig>{return Object.freeze({perceptionRadius:64+world.visibility*72,maxActorsPerTick:Math.max(32,Math.floor(world.populationCap*1.5)),maxStimuliPerActor:16+Math.floor(world.acousticRange*16),memoryHalfLifeTicks:Math.max(16,Math.floor(40+world.danger*40)),interestRadius:96});}
