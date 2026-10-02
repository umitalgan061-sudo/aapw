export type WeatherKind='clear'|'cloudy'|'rain'|'snow'|'blizzard'|'fog'|'storm';
export interface WeatherState{readonly kind:WeatherKind;readonly intensity:number;readonly wind:number;readonly visibility:number;readonly wetness:number;readonly snowCover:number;}
export interface WeatherSample{readonly temperature:number;readonly humidity:number;readonly pressure:number;readonly season:'winter'|'spring'|'summer'|'autumn';readonly seed:number;}
export class DeterministicWeatherDirector{
 #state:WeatherState={kind:'clear',intensity:0,wind:0,visibility:1,wetness:0,snowCover:0};
 evaluate(s:WeatherSample){const cold=s.temperature<0,wet=s.humidity>.72,unstable=s.pressure<990,intensity=clamp((1-s.pressure/1040)*.4+s.humidity*.35+(cold?.15:0),0,1);let kind:WeatherKind='clear';if(unstable&&wet&&s.temperature<2)kind=cold?'storm':'rain';else if(cold&&wet)kind='snow';else if(s.humidity>.92)kind='fog';else if(s.humidity>.65)kind='cloudy';if(kind==='rain'&&intensity>.8)kind='storm';if(kind==='snow'&&intensity>.82)kind='blizzard';this.#state=Object.freeze({kind,intensity,wind:clamp(intensity*18+(unstable?4:0),0,32),visibility:clamp(1-intensity*(kind==='fog'?.92:kind==='blizzard'?.82:kind==='storm'?.45:.25),.08,1),wetness:kind==='rain'||kind==='storm'?intensity:0,snowCover:cold&&kind!=='rain'?intensity:0});return this.#state;}
 state(){return this.#state;}reset(){this.#state={kind:'clear',intensity:0,wind:0,visibility:1,wetness:0,snowCover:0};}
}
function clamp(v:number,min:number,max:number){return Number.isFinite(v)?Math.max(min,Math.min(max,v)):min;}
