import { ClockIcon, DatabaseIcon, ChartLineIcon, CalculatorIcon, FunnelIcon, StrategyIcon, ShieldCheckIcon, LightningIcon, EyeIcon, GitMergeIcon } from '@phosphor-icons/react';

/** Shared visual vocabulary for the current graph and the packaged-node palette. */
export const nodePresentation = {
  trigger: { label: 'Trigger', icon: ClockIcon },
  data: { label: 'Data', icon: DatabaseIcon },
  indicator: { label: 'Indicator', icon: ChartLineIcon },
  process: { label: 'Process', icon: CalculatorIcon },
  condition: { label: 'Condition', icon: FunnelIcon },
  logic: { label: 'Logic', icon: GitMergeIcon },
  strategy: { label: 'Strategy', icon: StrategyIcon },
  risk: { label: 'Risk', icon: ShieldCheckIcon },
  action: { label: 'Action', icon: LightningIcon },
  output: { label: 'Output', icon: EyeIcon },
} as const;
export type NodeVisualCategory = keyof typeof nodePresentation;
export const programNodeSize = { width: 264, height: 196, firstPort: 108, portGap: 26 } as const;
export function nodeVisualCategory(kind: string, type: string): NodeVisualCategory {
  if (type.startsWith('combine.')) return 'logic';
  return Object.hasOwn(nodePresentation, kind) ? kind as NodeVisualCategory : 'condition';
}
