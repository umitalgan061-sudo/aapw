import type { GateResult, ValidationReport } from './validation.js';
import { validatePolicyMatrix } from './policyMatrix.js';
import { validateScenarioMatrix } from './adversarialMatrix.js';

export interface ReleaseEvidence {readonly generatedAt:number;readonly commitBase:string;readonly checks:readonly GateResult[];readonly report:ValidationReport;readonly policyErrors:readonly string[];readonly matrixErrors:readonly string[];}
export function releaseEvidence(commitBase:string,checks:readonly GateResult[],report:ValidationReport):ReleaseEvidence{return Object.freeze({generatedAt:Date.now(),commitBase,checks:Object.freeze([...checks]),report,policyErrors:validatePolicyMatrix(),matrixErrors:validateScenarioMatrix()});}
export function releaseGate(evidence:ReleaseEvidence):boolean{return evidence.report.passed&&evidence.policyErrors.length===0&&evidence.matrixErrors.length===0&&evidence.checks.every(c=>c.passed);}
