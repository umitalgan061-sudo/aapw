/** Deterministic world clock/environment state independent from rendering. */
export type WeatherTypeV15='clear'|'cloudy'|'rain'|'storm'|'snow'|'fog'|'heat';
export interface WorldEnvironmentStateV15{readonly tick:number;readonly timeOfDay:number;readonly day:number;readonly season:'spring'|'summer'|'autumn'|'winter';readonly temperatureC:number;readonly humidity:number;readonly windX:number;readonly windZ:number;readonly weather:WeatherTypeV15;readonly precipitation:number;readonly visibility:number;readonly moonPhase:number;}
export interface EnvironmentConfigV15{readonly ticksPerDay?:number;readonly seasonDays?:number;readonly baseTemperature?:number;readonly amplitude?:number;readonly seed?:number;}
export interface EnvironmentEventV15{readonly tick:number;readonly type:'day'|'season'|'weather';readonly value:string|number;}

const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,Number.isFinite(v)?v:a));
const hash=(seed:number,tick:number):number=>{let x=(seed|0)^Math.imul(tick|0,0x45d9f3b);x=Math.imul(x^(x>>>16),0x45d9f3b);x=Math.imul(x^(x>>>16),0x45d9f3b);return((x^(x>>>16))>>>0)/4294967295;};

export class WorldSimulationV15{
  readonly #ticksPerDay:number;readonly #seasonDays:number;readonly #baseTemperature:number;readonly #amplitude:number;readonly #seed:number;
  #state:WorldEnvironmentStateV15;#events:EnvironmentEventV15[]=[];
  constructor(config:EnvironmentConfigV15={}){this.#ticksPerDay=Math.max(60,Math.trunc(config.ticksPerDay??3600));this.#seasonDays=Math.max(1,Math.trunc(config.seasonDays??30));this.#baseTemperature=config.baseTemperature??12;this.#amplitude=Math.max(0,config.amplitude??18);this.#seed=Math.trunc(config.seed??1);this.#state=this.makeState(0);}
  state():WorldEnvironmentStateV15{return this.#state;}
  tick(deltaTicks=1):WorldEnvironmentStateV15{
    const nextTick=this.#state.tick+Math.max(1,Math.trunc(deltaTicks));const day=Math.floor(nextTick/this.#ticksPerDay);const time=(nextTick%this.#ticksPerDay)/this.#ticksPerDay;const seasonIndex=Math.floor(day/this.#seasonDays)%4;const seasons=['spring','summer','autumn','winter'] as const;const season=seasons[seasonIndex]??'spring';
    const seasonTemperature=seasonIndex===1?this.#amplitude*.35:seasonIndex===3?-this.#amplitude*.35:0;const solar=Math.sin((time-.25)*Math.PI*2);const noise=hash(this.#seed,Math.floor(nextTick/60))*2-1;const temperature=this.#baseTemperature+solar*this.#amplitude+seasonTemperature+noise*2;
    const weatherNoise=hash(this.#seed+101,Math.floor(nextTick/120));let weather:WeatherTypeV15=temperature<0&&weatherNoise>.55?'snow':weatherNoise>.92?'storm':weatherNoise>.78?'rain':weatherNoise>.6?'cloudy':weatherNoise<.12?'fog':'clear';
    const precipitation=weather==='storm'?1:weather==='rain'?.65:weather==='snow'?.7:0;const humidity=clamp(.35+precipitation*.55+hash(this.#seed+7,Math.floor(nextTick/300))*.2,0,1);const windMagnitude=weather==='storm'?1:weather==='rain'?.65:.25+hash(this.#seed+11,Math.floor(nextTick/90))*.45;const windAngle=hash(this.#seed+13,Math.floor(nextTick/240))*Math.PI*2;
    const previous=this.#state;this.#state=Object.freeze({tick:nextTick,timeOfDay:time,day,season,temperatureC:Number(temperature.toFixed(3)),humidity:Number(humidity.toFixed(3)),windX:Number((Math.cos(windAngle)*windMagnitude).toFixed(3)),windZ:Number((Math.sin(windAngle)*windMagnitude).toFixed(3)),weather,precipitation:Number(precipitation.toFixed(3)),visibility:weather==='fog'?.35:weather==='storm'?.55:weather==='rain'?.75:1,moonPhase:(day%29.53)/29.53});
    if(previous.day!==day)this.#events.push({tick:nextTick,type:'day',value:day});if(previous.season!==season)this.#events.push({tick:nextTick,type:'season',value:season});if(previous.weather!==weather)this.#events.push({tick:nextTick,type:'weather',value:weather});return this.#state;
  }

  drainEvents():readonly EnvironmentEventV15[]{const events=Object.freeze([...this.#events]);this.#events.length=0;return events;}
  forecast(days:number):readonly WorldEnvironmentStateV15[]{const count=Math.max(0,Math.min(30,Math.trunc(days)));const base=this.#state;const values:WorldEnvironmentStateV15[]=[];this.#state=base;for(let day=1;day<=count;day+=1){const target=base.tick+day*this.#ticksPerDay;const delta=target-this.#state.tick;this.tick(delta);values.push(this.#state);}this.#state=base;this.#events.length=0;return Object.freeze(values.map((value)=>Object.freeze({...value})));}
  snapshot():WorldEnvironmentStateV15{return Object.freeze({...this.#state});}
  reset(tick=0):void{this.#state=this.makeState(Math.max(0,Math.trunc(tick)));this.#events.length=0;}

  makeState(tick:number):WorldEnvironmentStateV15{return Object.freeze({tick,timeOfDay:(tick%this.#ticksPerDay)/this.#ticksPerDay,day:Math.floor(tick/this.#ticksPerDay),season:'spring',temperatureC:this.#baseTemperature,humidity:.5,windX:0,windZ:0,weather:'clear',precipitation:0,visibility:1,moonPhase:0});}
}

export const worldPhaseFromTimeV15=(timeOfDay:number):'night'|'dawn'|'day'|'dusk'=>{const t=((timeOfDay%1)+1)%1;return t<.2||t>=.8?'night':t<.3?'dawn':t<.7?'day':'dusk';};

export const weatherMovementMultiplierV15=(weather:WeatherTypeV15):number=>weather==='storm'?.82:weather==='snow'?.9:weather==='rain'?.95:weather==='fog'?.98:1;
