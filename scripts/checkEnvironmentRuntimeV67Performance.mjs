import assert from 'node:assert/strict';
import { performanceSummaryV67, frameHeadroomV67, performanceBandV67 } from '../src/3d/world/environmentRuntimePerformanceV67.js';

const samples=Array.from({length:64},(_,i)=>({
 id:`perf-${i}`,
 elevation:300+i*12,
 slope:i%70,
 moisture:.25+(i%7)*.1,
 temperature:6+(i%8)*2,
 wind:4+i%20,
 visibility:.4+(i%6)*.08,
 rain:i%5*.12,
 canopy:.2+(i%6)*.12,
 humanPressure:i%9===0?.7:.08,
}));

const desktop=performanceSummaryV67(samples,'desktop');
const mobile=performanceSummaryV67(samples,'mobile');
const tablet=performanceSummaryV67(samples,'tablet');
assert.equal(desktop.samples,64);
assert.equal(mobile.samples,64);
assert.equal(tablet.samples,64);
assert.ok(desktop.cost>0);
assert.ok(mobile.cost>=desktop.cost);
assert.ok(tablet.cost>=desktop.cost);
assert.ok(desktop.perSample>0);
assert.ok(desktop.headroom<=1);
assert.ok(desktop.headroom>=0);
assert.ok(frameHeadroomV67(0)===1);
assert.ok(frameHeadroomV67(100)>=0);
assert.ok(['fast','normal','heavy','over-budget'].includes(performanceBandV67(desktop.cost/samples.length)));
assert.ok(desktop.pressure>=0&&desktop.pressure<=1);
assert.ok(desktop.throttle>=0&&desktop.throttle<=1);
assert.ok(['near','mid','far'].includes(desktop.recommended));
assert.ok(mobile.throttle>=desktop.throttle);
console.log('V67 performance regression PASS');
