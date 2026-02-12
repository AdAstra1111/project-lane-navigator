/**
 * Lifecycle Stage definitions for IFFY's production intelligence system.
 * Projects flow through 6 core stages, each with its own readiness scoring.
 */

import {
  Lightbulb,
  Package,
  HardHat,
  Clapperboard,
  Film,
  ShoppingCart,
  type LucideIcon,
} from 'lucide-react';

export type LifecycleStage =
  | 'development'
  | 'packaging'
  | 'pre-production'
  | 'production'
  | 'post-production'
  | 'sales-delivery';

export interface LifecycleStageMeta {
  value: LifecycleStage;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  description: string;
  color: string; // Tailwind border/bg token
  order: number;
}

export const LIFECYCLE_STAGES: LifecycleStageMeta[] = [
  {
    value: 'development',
    label: 'Development',
    shortLabel: 'Dev',
    icon: Lightbulb,
    description: 'Creative and commercial validation',
    color: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
    order: 0,
  },
  {
    value: 'packaging',
    label: 'Packaging',
    shortLabel: 'Pkg',
    icon: Package,
    description: 'Attach elements that unlock financing',
    color: 'text-primary border-primary/30 bg-primary/10',
    order: 1,
  },
  {
    value: 'pre-production',
    label: 'Pre-Production',
    shortLabel: 'Pre-Pro',
    icon: HardHat,
    description: 'Convert creative into executable plan',
    color: 'text-sky-400 border-sky-500/30 bg-sky-500/10',
    order: 2,
  },
  {
    value: 'production',
    label: 'Production',
    shortLabel: 'Prod',
    icon: Clapperboard,
    description: 'Monitor burn and schedule stability',
    color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    order: 3,
  },
  {
    value: 'post-production',
    label: 'Post-Production',
    shortLabel: 'Post',
    icon: Film,
    description: 'Creative lock and delivery readiness',
    color: 'text-violet-400 border-violet-500/30 bg-violet-500/10',
    order: 4,
  },
  {
    value: 'sales-delivery',
    label: 'Sales & Delivery',
    shortLabel: 'Sales',
    icon: ShoppingCart,
    description: 'Monetisation and recoupment optimisation',
    color: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
    order: 5,
  },
];

export function getStageMeta(stage: LifecycleStage): LifecycleStageMeta {
  return LIFECYCLE_STAGES.find(s => s.value === stage) || LIFECYCLE_STAGES[0];
}

export function getStageOrder(stage: LifecycleStage): number {
  return getStageMeta(stage).order;
}

export function getNextStage(stage: LifecycleStage): LifecycleStage | null {
  const order = getStageOrder(stage);
  const next = LIFECYCLE_STAGES.find(s => s.order === order + 1);
  return next?.value ?? null;
}

export function getPrevStage(stage: LifecycleStage): LifecycleStage | null {
  const order = getStageOrder(stage);
  const prev = LIFECYCLE_STAGES.find(s => s.order === order - 1);
  return prev?.value ?? null;
}

/** Check if a stage is unlocked (all prior stages exist or override) */
export function isStageAccessible(
  targetStage: LifecycleStage,
  currentStage: LifecycleStage,
): boolean {
  // All stages up to and including current are accessible, plus one ahead
  const currentOrder = getStageOrder(currentStage);
  const targetOrder = getStageOrder(targetStage);
  return targetOrder <= currentOrder + 1;
}
