import { describe,expect,it } from 'vitest';
import { R16RuntimeHealthAggregator } from '../../../src/3d/modern/r16/runtimeHealth.js';
import { R16SecurityAuditLog } from '../../../src/3d/modern/r16/securityAudit.js';
import { R16NetworkSecurityBoundary } from '../../../src/3d/modern/r16/networkSecurity.js';

describe('R16 health and security gates',()=>{
  it('aggregates subsystem pressure into a diagnostic report',()=>{
    const health=new R16RuntimeHealthAggregator();
    const report=health.evaluate({commandRejected:0,framePressure:.2,memoryPressure:.1,networkRejected:.0,workerFailures:0,saveFailures:0},10);
    expect(report.state).toBe('healthy');
    const degraded=health.evaluate({commandRejected:.3,framePressure:.95,memoryPressure:.8,networkRejected:.2,workerFailures:.1,saveFailures:.1},11);
    expect(degraded.score).toBeLessThan(report.score);
  });
  it('records explicit security findings and network rejection counters',()=>{
    const audit=new R16SecurityAuditLog();audit.record('bad-cmd','block','command','invalid signature',4);
    expect(audit.audit().block).toBe(1);
    const security=new R16NetworkSecurityBoundary();
    const envelope=security.createEnvelope('rpc','peer',1,4,'network','x',{ok:true},50);
    expect(security.validate({...envelope,checksum:'deadbeef'},4).ok).toBe(false);
    expect(security.stats().invalidRejected).toBeGreaterThan(0);
  });
});
