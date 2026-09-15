import { clamp01, finiteV67, hashV67, normalizeSampleV67, seasonPhaseV67 } from './environmentRuntimeV67.js';

export const EVENTS_V67 = Object.freeze({
  id:'events-v67',
  version:67,
  deterministic:true,
  noWorldMutation:true,
});

const EVENT_TYPES = Object.freeze([
  'rainfront',
  'fogbank',
  'snowpulse',
  'heatwave',
  'rivercrest',
  'wildlife-movement',
  'surface-drydown',
]);

export const eventEnergyV67 = (sample={},seed='67') => {
  const s=normalizeSampleV67(sample);
  const hash=parseInt(hashV67(`${seed}:${s.id}`),16)/0xffffffff;
  return clamp01(
    s.rain*.24+
    (1-s.visibility)*.16+
    s.snow*.16+
    clamp01((s.temperature-27)/16)*.12+
    s.wind*.12+
    (1-s.moisture)*.08+
    hash*.12,
  );
};

export const eventTypeV67 = (sample={},seed='67') => {
  const s=normalizeSampleV67(sample);
  const energy=eventEnergyV67(s,seed);
  if(s.rain>.72)return 'rainfront';
  if(s.visibility<.28)return 'fogbank';
  if(s.snow>.58)return 'snowpulse';
  if(s.temperature>30)return 'heatwave';
  if(s.waterDistance<35&&s.rain>.5)return 'rivercrest';
  if(s.humanPressure<.2&&s.canopy<.5)return 'wildlife-movement';
  return energy<.2?'surface-drydown':'rainfront';
};

export const eventDurationV67 = (type='rainfront',energy=.5) => {
  const base={rainfront:5,fogbank:3,snowpulse:6,heatwave:18,rivercrest:4,'wildlife-movement':7,'surface-drydown':10}[type]??5;
  return Math.max(1,Math.round(base*(.65+clamp01(energy)*.7)));
};

export const buildEventV67 = (sample={},context={}) => {
  const energy=eventEnergyV67(sample,context.seed??'67');
  const type=eventTypeV67(sample,context.seed??'67');
  const phase=seasonPhaseV67(context.dayOfYear??180);
  return {
    id:`${context.seed??'67'}:${normalizeSampleV67(sample).id}:${type}`,
    type,
    phase,
    energy,
    durationHours:eventDurationV67(type,energy),
    visualIntent:visualIntentV67(type,energy),
  };
};

export const visualIntentV67 = (type,energy=0) => ({
  mist: type==='fogbank' ? clamp01(.35+energy*.8) : 0,
  precipitation:['rainfront','snowpulse','rivercrest'].includes(type)?clamp01(.2+energy*.7):0,
  shimmer:type==='heatwave'?clamp01(energy):0,
  wildlifeMotion:type==='wildlife-movement'?clamp01(.4+energy*.6):0,
  wetness:['rainfront','rivercrest'].includes(type)?clamp01(.45+energy*.5):0,
});

export const collapseEventsV67 = (events=[]) => {
  const map=new Map();
  for(const event of events){
    const key=event.type;
    const prior=map.get(key);
    if(!prior||event.energy>prior.energy)map.set(key,event);
  }
  return [...map.values()].sort((a,b)=>b.energy-a.energy);
};

export const synthesizeEnvironmentEventsV67 = (samples=[],context={}) => {
  const events=samples.map(sample=>buildEventV67(sample,context));
  const collapsed=collapseEventsV67(events);
  return {events:collapsed,rawCount:events.length,activeCount:collapsed.length};
};

export const eventPressureV67 = (events=[]) => clamp01(events.reduce((sum,event)=>sum+event.energy,0)/Math.max(1,events.length));
export const dominantEventV67 = (events=[]) => events.slice().sort((a,b)=>b.energy-a.energy)[0]??null;

export const eventTelemetryV67 = (set={events:[]}) => ({
  policy:EVENTS_V67.id,
  raw:set.rawCount??0,
  active:set.activeCount??0,
  pressure:eventPressureV67(set.events??[]),
  dominant:dominantEventV67(set.events??[])?.type??'none',
  types:Object.fromEntries(EVENT_TYPES.map(type=>[type,(set.events??[]).filter(x=>x.type===type).length])),
});

export const validateEventsV67 = (set={events:[]}) => {
  const errors=[];
  if(!Array.isArray(set.events))errors.push('events');
  if((set.events??[]).some(x=>!EVENT_TYPES.includes(x.type)))errors.push('type');
  if((set.events??[]).some(x=>x.energy<0||x.energy>1))errors.push('energy');
  return {ok:errors.length===0,errors};
};

export const eventPriorityV67 = (event={}) =>
  clamp01(event.energy*.7+(event.type==='rivercrest'?0.15:0)+(event.type==='heatwave'?0.1:0));
