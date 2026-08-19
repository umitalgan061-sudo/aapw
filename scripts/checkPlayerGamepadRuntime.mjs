#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';
const { loadPlaywright, startStaticServer } = devServerHelper;
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = path.resolve(outArg ? outArg.slice('--out-dir='.length) : 'artifacts/player-gamepad');
const need = (ok, message) => { if (!ok) throw new Error(`[player-gamepad-runtime] ${message}`); };
const playwright = loadPlaywright(); need(Boolean(playwright), 'Playwright unavailable'); fs.mkdirSync(outDir, { recursive: true });
const server = await startStaticServer(); const browser = await playwright.chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', (e) => errors.push(`page:${e.message}`)); page.on('console', (m) => { if (m.type() === 'error') errors.push(`console:${m.text()}`); });
await page.addInitScript(() => {
	window.__runtimePads=[]; window.__gamepadMotion=[]; window.__gamepadInputs=[]; window.__gamepadDevices=[]; window.__gamepadAttacks=[]; window.__gamepadHaptics=[];
	Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.__runtimePads});
	window.addEventListener('aapw:player-motion',(e)=>{window.__gamepadMotion.push(structuredClone(e.detail)); if(window.__gamepadMotion.length>1200) window.__gamepadMotion.shift();});
	window.addEventListener('aapw:player-combat-input',(e)=>window.__gamepadInputs.push(structuredClone(e.detail)));
	window.addEventListener('aapw:player-input-device',(e)=>window.__gamepadDevices.push(structuredClone(e.detail)));
	window.addEventListener('aapw:player-attack-window',(e)=>window.__gamepadAttacks.push(structuredClone(e.detail)));
});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function waitFor(read,predicate,label,timeout=10000,interval=50){const deadline=Date.now()+timeout;let last=null;while(Date.now()<deadline){last=await read();const found=predicate(last);if(found)return found;await sleep(interval);}throw new Error(`[player-gamepad-runtime] timed out waiting for ${label}; last=${JSON.stringify(last)}`);}
const histories=()=>page.evaluate(()=>({motion:structuredClone(window.__gamepadMotion),inputs:structuredClone(window.__gamepadInputs),devices:structuredClone(window.__gamepadDevices),attacks:structuredClone(window.__gamepadAttacks),haptics:structuredClone(window.__gamepadHaptics)}));
const latestMotion=()=>page.evaluate(()=>structuredClone(window.__gamepadMotion.at(-1))); const waitHistory=(key,predicate,label,timeout)=>waitFor(histories,(h)=>[...h[key]].reverse().find(predicate)??null,label,timeout); const resetMotionHistory=()=>page.evaluate(()=>{window.__gamepadMotion.length=0;});
async function setPads(specs){await page.evaluate((nextSpecs)=>{window.__runtimePads=nextSpecs.map((spec)=>({index:spec.index,id:`AAPW Runtime Pad ${spec.index}`,connected:spec.connected!==false,mapping:spec.mapping??'standard',axes:spec.axes??[0,0,0,0],buttons:Array.from({length:12},(_,index)=>{const value=Number(spec.values?.[index]??(spec.buttons?.[index]?1:0));return{pressed:Boolean(spec.buttons?.[index])||value>0.5,value};}),vibrationActuator:spec.haptics===false?null:{playEffect:(type,options)=>{window.__gamepadHaptics.push({gamepadIndex:spec.index,type,options:structuredClone(options)});return Promise.resolve('complete');}},timestamp:performance.now()}));},specs);}
const directionBetween=(start,end)=>{if(!start?.position||!end?.position)return null;const dx=end.position.x-start.position.x,dz=end.position.z-start.position.z,length=Math.hypot(dx,dz);return length>0.01?{x:dx/length,z:dz/length,distance:length}:null;};
async function moveThenStop(padSpec, label, durationMs=420){
	const start=await latestMotion();
	need(start?.state==='idle'&&start.isGrounded,`${label} must start from grounded idle`);
	await resetMotionHistory();
	await setPads([padSpec]);
	const moving=await waitHistory('motion',(m)=>m.state==='walk'&&m.speedMps>0.5,`${label} walk`);
	await sleep(durationMs);
	await resetMotionHistory();
	await setPads([{index:padSpec.index}]);
	const end=await waitHistory('motion',(m)=>m.state==='idle'&&m.isGrounded,`${label} stop`,5000);
	return { start, moving, end, direction: directionBetween(start,end) };
}
try{
	await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`,{waitUntil:'domcontentloaded',timeout:30000}); await page.locator('#run266-entry-enter').click(); await page.waitForFunction(()=>document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'),null,{timeout:90000});
	const baseline=await waitHistory('motion',(m)=>m.state==='idle'&&m.isGrounded,'grounded idle baseline',15000); need(baseline.attackKind==='none','baseline combat state');
	const before=(await histories()).inputs.length; await setPads([{index:1,buttons:{2:true}}]); const firstDevice=await waitHistory('devices',(e)=>e.device==='gamepad'&&e.gamepadIndex===1,'initial selection'); await sleep(350); need((await histories()).inputs.length===before,'phantom connect input'); need(firstDevice.reason==='selected','bad device reason');
	await setPads([{index:1}]); await sleep(120); await setPads([{index:1,buttons:{2:true}}]); const lightInput=await waitHistory('inputs',(e)=>e.kind==='light'&&e.source==='gamepad','X light'); const lightStart=await waitHistory('attacks',(e)=>e.kind==='light'&&e.phase==='start','light start'); const lightHaptic=await waitHistory('haptics',(e)=>e.gamepadIndex===1,'light haptic'); need(lightStart.comboStep===1&&lightHaptic.type==='dual-rumble','light chain'); await waitHistory('attacks',(e)=>e.serial===lightStart.serial&&e.phase==='finish','light finish',20000);
	await setPads([{index:1}]); await resetMotionHistory(); const postAttackIdle=await waitHistory('motion',(m)=>m.state==='idle'&&m.isGrounded,'post-light idle',5000);
	await resetMotionHistory(); await setPads([{index:1,axes:[0,-0.59,0,0]}]); const partial=await waitHistory('motion',(m)=>m.state==='walk'&&m.speedMps>0.5,'partial walk'); await setPads([{index:1}]); await waitHistory('motion',(m)=>m.state==='idle','partial neutral');
	const fullRun=await moveThenStop({index:1,axes:[0,-1,0,0]},'full walk'); const full=fullRun.moving; const ratio=partial.speedMps/full.speedMps; need(ratio>0.42&&ratio<0.58,`analog ratio ${ratio}`); const beforeDir=fullRun.direction; need(beforeDir?.distance>0.5,`baseline displacement ${beforeDir?.distance ?? 0}`);
	await setPads([{index:1,axes:[0,0,1,0]}]); await sleep(520); await setPads([{index:1}]); await sleep(120); const orbitRun=await moveThenStop({index:1,axes:[0,-1,0,0],values:{7:0.35}},'post-orbit walk'); const afterDir=orbitRun.direction; need(afterDir?.distance>0.5,`post orbit displacement ${afterDir?.distance ?? 0}`); const dot=beforeDir.x*afterDir.x+beforeDir.z*afterDir.z; need(dot<0.8,`camera direction dot ${dot}`);
	const dodgeBase=await latestMotion(); await resetMotionHistory(); await setPads([{index:1,axes:[0,-1,0,0],buttons:{1:true}}]); const dodge=await waitHistory('motion',(m)=>m.state==='dodge'&&m.dodgeRemaining>0&&m.stamina<dodgeBase.stamina,'B dodge',5000); need(dodge.speedMps>full.speedMps,`dodge speed ${dodge.speedMps}`); await setPads([{index:1}]); await waitHistory('motion',(m)=>m.state==='idle'&&m.dodgeRemaining===0,'dodge recovery',5000);
	await resetMotionHistory(); await setPads([{index:1,axes:[0,-1,0,0],buttons:{10:true}}]); const sprint=await waitHistory('motion',(m)=>m.state==='sprint'&&m.runIntent&&m.speedMps>6&&m.stamina<dodge.stamina,'sprint');
	const heavyBefore=(await histories()).inputs.filter((e)=>e.kind==='heavy').length; await setPads([{index:0,axes:[-1,0,0,0],buttons:{3:true}},{index:1,axes:[0,-1,0,0],buttons:{10:true}}]); await sleep(350); let snapshot=await histories(); need(snapshot.devices.filter((e)=>e.gamepadIndex===0).length===0,'hotplug steal'); need(snapshot.inputs.filter((e)=>e.kind==='heavy').length===heavyBefore,'inactive heavy');
	await setPads([{index:0,axes:[-1,0,0,0],buttons:{3:true,4:true}},{index:1,connected:false}]); const fallback=await waitHistory('devices',(e)=>e.device==='gamepad'&&e.gamepadIndex===0,'fallback'); const guard=await waitHistory('motion',(m)=>m.guarding===true,'fallback guard'); await sleep(250); snapshot=await histories(); need(snapshot.inputs.filter((e)=>e.kind==='heavy').length===heavyBefore,'phantom fallback heavy'); need(fallback.reason==='selected'&&guard.guarding,'fallback state');
	await setPads([{index:0}]); await sleep(120); await setPads([{index:0,buttons:{3:true}}]); const heavyInput=await waitHistory('inputs',(e)=>e.kind==='heavy'&&e.source==='gamepad','Y heavy'); const heavyStart=await waitHistory('attacks',(e)=>e.kind==='heavy'&&e.phase==='start'&&e.serial>lightStart.serial,'heavy start'); const heavyHaptic=await waitHistory('haptics',(e)=>e.gamepadIndex===0,'heavy haptic'); need(heavyStart.damageScale>1&&heavyHaptic.options.strongMagnitude>lightHaptic.options.strongMagnitude,'heavy chain');
	await setPads([]); const disconnected=await waitHistory('devices',(e)=>e.device==='keyboard-pointer'&&e.gamepadIndex===null,'disconnect'); need(disconnected.reason==='disconnected','disconnect reason');
	await page.screenshot({path:path.join(outDir,'gamepad-runtime.png'),fullPage:true}); snapshot=await histories(); need(errors.length===0,`browser errors ${JSON.stringify(errors)}`);
	const metrics={ok:true,baseline:{state:baseline.state,stamina:baseline.stamina},light:{input:lightInput,serial:lightStart.serial,haptic:lightHaptic.options},analog:{partialSpeedMps:partial.speedMps,fullSpeedMps:full.speedMps,ratio:Number(ratio.toFixed(3)),fullDisplacementMeters:Number(beforeDir.distance.toFixed(3))},camera:{directionDotAfterRightStick:Number(dot.toFixed(3)),postOrbitDisplacementMeters:Number(afterDir.distance.toFixed(3)),triggerZoomExercised:0.35},dodge:{state:dodge.state,speedMps:dodge.speedMps,staminaBefore:dodgeBase.stamina,staminaAfter:dodge.stamina},sprint:{speedMps:sprint.speedMps,stamina:sprint.stamina,state:sprint.state},fallback:{device:fallback,guarding:guard.guarding},heavy:{input:heavyInput,serial:heavyStart.serial,damageScale:heavyStart.damageScale,haptic:heavyHaptic.options},browserErrors:errors};
	fs.writeFileSync(path.join(outDir,'gamepad-runtime.json'),`${JSON.stringify(metrics,null,2)}\n`); console.log(`PLAYER_GAMEPAD_RUNTIME_OK ${JSON.stringify({analogRatio:metrics.analog.ratio,cameraDot:metrics.camera.directionDotAfterRightStick,dodgeSpeedMps:dodge.speedMps,sprintSpeedMps:sprint.speedMps,errors:errors.length})}`);
}finally{await browser.close();await new Promise((resolve)=>server.close(resolve));}
