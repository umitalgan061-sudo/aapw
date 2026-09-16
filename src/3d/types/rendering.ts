import type { Backend, DeviceCapabilities, QualityTier, RuntimeBudgets, Vec2 } from './runtimeContract.js';

export type AntiAliasing = 'none' | 'fxaa' | 'taa';
export type ShadowMode = 'none' | 'pcf' | 'vsm' | 'evsm';
export type ToneMapping = 'none' | 'neutral' | 'aces' | 'agx';
export type Upscaler = 'native' | 'dynamic-resolution' | 'fsr-like';
export type RenderPassName = 'depth' | 'shadow' | 'opaque' | 'transparent' | 'water' | 'foliage' | 'effects' | 'post' | 'ui';

export interface RenderResolution {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

export interface RenderFeatures {
  readonly backend: Backend;
  readonly hdr: boolean;
  readonly mrt: boolean;
  readonly temporalHistory: boolean;
  readonly compute: boolean;
  readonly ssao: boolean;
  readonly ssgi: boolean;
  readonly bloom: boolean;
  readonly depthOfField: boolean;
  readonly volumetricFog: boolean;
  readonly antiAliasing: AntiAliasing;
  readonly shadows: ShadowMode;
  readonly toneMapping: ToneMapping;
  readonly upscaler: Upscaler;
}

export interface RenderPipelineConfig {
  readonly tier: QualityTier;
  readonly resolution: RenderResolution;
  readonly features: RenderFeatures;
  readonly budgets: RuntimeBudgets;
}

export interface RenderObject {
  readonly nodeId: string;
  readonly layer: number;
  readonly materialClass: string;
  readonly instanceGroup?: string;
  readonly distance: number;
  readonly screenCoverage: number;
  readonly castsShadow: boolean;
  readonly animated: boolean;
  readonly transparent: boolean;
  readonly visible: boolean;
}

export interface FramePlan {
  readonly frameId: number;
  readonly resolution: RenderResolution;
  readonly passes: readonly RenderPassName[];
  readonly visibleObjectIds: readonly string[];
  readonly shadowObjectIds: readonly string[];
  readonly animatedObjectIds: readonly string[];
  readonly estimatedGpuMs: number;
  readonly cpuUploadMs: number;
}

export interface DeviceContext {
  readonly capabilities: DeviceCapabilities;
  readonly preferredFormat: string;
  readonly pixelRatio: number;
  readonly canvasSize: Vec2;
}

export function estimateFrameCost(plan: Pick<FramePlan, 'passes' | 'visibleObjectIds' | 'shadowObjectIds' | 'estimatedGpuMs'>): number {
  const passCost = plan.passes.length * 0.18;
  const objectCost = plan.visibleObjectIds.length * 0.0025;
  const shadowCost = plan.shadowObjectIds.length * 0.006;
  return passCost + objectCost + shadowCost + Math.max(0, plan.estimatedGpuMs);
}

export function shouldDropOptionalPass(costMs: number, budgetMs: number, pressure: number): boolean {
  if (budgetMs <= 0) return true;
  return costMs > budgetMs * (1 + Math.max(0, pressure));
}
