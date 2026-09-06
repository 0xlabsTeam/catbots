/** Browser-safe legacy inspection. No execution adapter is imported. */
export { evaluateConditionNode } from './condition-evaluator';
export { createEvaluationContext } from './evaluation-context';
export type { StrategyNode } from './strategy-schema';
export { matchesIntervalTrigger, matchesEventTrigger } from './triggers';
export type { IntervalTriggerConfig, EventTriggerConfig } from './triggers';
