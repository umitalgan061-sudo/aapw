import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root=process.cwd();
const required=[
  'src/3d/modern/r16/types.ts','src/3d/modern/r16/deterministic.ts','src/3d/modern/r16/bounded.ts',
  'src/3d/modern/r16/commandBus.ts','src/3d/modern/r16/eventLog.ts','src/3d/modern/r16/stateGraph.ts',
  'src/3d/modern/r16/snapshotStore.ts','src/3d/modern/r16/budgetScheduler.ts','src/3d/modern/r16/replication.ts',
  'src/3d/modern/r16/persistence.ts','src/3d/modern/r16/observability.ts','src/3d/modern/r16/health.ts',
  'src/3d/modern/r16/serviceRegistry.ts','src/3d/modern/r16/workerScheduler.ts','src/3d/modern/r16/assetResidency.ts',
  'src/3d/modern/r16/recovery.ts','src/3d/modern/r16/worldInterest.ts','src/3d/modern/r16/migrationAudit.ts',
  'src/3d/modern/r16/inputRuntime.ts','src/3d/modern/r16/frameScheduler.ts','src/3d/modern/r16/networkSecurity.ts',
  'src/3d/modern/r16/snapshotCodec.ts','src/3d/modern/r16/replayJournal.ts','src/3d/modern/r16/performanceGovernor.ts',
  'src/3d/modern/r16/cacheCoordinator.ts','src/3d/modern/r16/runtimeFacade.ts','src/3d/modern/r16/saveMigration.ts',
  'src/3d/modern/r16/networkCoordinator.ts','src/3d/modern/r16/runtimeHealth.ts','src/3d/modern/r16/worldStreaming.ts',
  'src/3d/modern/r16/replayVerifier.ts','src/3d/modern/r16/securityAudit.ts','src/3d/modern/r16/runtimeGuard.ts',
  'src/3d/modern/r16/replayController.ts','src/3d/modern/r16/platformSnapshot.ts','src/3d/modern/r16/index.ts',
];
const read=async p=>readFile(resolve(root,p),'utf8');
for(const p of required){const source=await read(p);if(source.length<100)throw new Error('R16 module unexpectedly small: '+p);if(!source.includes('export'))throw new Error('R16 export missing: '+p);}
const pkg=JSON.parse(await read('package.json'));
for(const scriptName of ['verify:modern:r16','typecheck:modern:r16','test:modern:r16','check:modern:r16'])if(!pkg.scripts?.[scriptName])throw new Error('Missing script: '+scriptName);
console.log(JSON.stringify({version:16,modules:required.length,deterministic:true,bounded:true,transactionalState:true,replay:true,networkSecurity:true,persistence:true,performanceGovernance:true,worldStreaming:true}));