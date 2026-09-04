import { z } from 'zod';

import { BotSummarySchema } from './bots';

const BotIdSchema = z.string().uuid();
const TimestampSchema = z.string().datetime();
const HashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const WorkbenchNodeSchema = z.object({
  id: z.string().trim().min(1),
  kind: z.enum(['trigger', 'condition', 'action']),
  type: z.string().trim().min(1),
  version: z.number().int().positive(),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
}).strict();

export const WorkbenchEdgeSchema = z.object({
  id: z.string().trim().min(1),
  source: z.string().trim().min(1),
  sourcePort: z.string().trim().min(1),
  target: z.string().trim().min(1),
  targetPort: z.string().trim().min(1),
}).strict();

export const StrategyRevisionStatusSchema = z.enum(['draft', 'approved']);

export const StrategyRevisionSchema = z.object({
  botId: BotIdSchema,
  strategyId: z.string().trim().min(1),
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  status: StrategyRevisionStatusSchema,
  createdAt: TimestampSchema,
  approvedAt: TimestampSchema.nullable(),
  nodes: z.array(WorkbenchNodeSchema),
  edges: z.array(WorkbenchEdgeSchema),
}).strict();

export type StrategyRevision = z.infer<typeof StrategyRevisionSchema>;

export const StrategyRevisionSummarySchema = z.object({
  version: z.number().int().positive(),
  status: StrategyRevisionStatusSchema,
  createdAt: TimestampSchema,
  approvedAt: TimestampSchema.nullable(),
}).strict();

export type StrategyRevisionSummary = z.infer<typeof StrategyRevisionSummarySchema>;

export const ChatMessageSchema = z.object({
  id: z.string().uuid(),
  botId: BotIdSchema,
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(100_000),
  createdAt: TimestampSchema,
}).strict();

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const AgentToolNameSchema = z.enum([
  'list_nodes',
  'list_data_products',
  'validate_strategy',
  'backtest_strategy',
  'explain_strategy',
  'compare_versions',
]);

export const AgentToolActivitySchema = z.object({
  botId: BotIdSchema,
  requestId: z.string().uuid(),
  phase: z.enum(['thinking', 'tool_started', 'tool_completed', 'backtest_progress', 'completed', 'failed']),
  tool: AgentToolNameSchema.optional(),
  message: z.string().trim().min(1).max(500),
  progress: z.number().min(0).max(1).optional(),
}).strict();

export type AgentToolActivity = z.infer<typeof AgentToolActivitySchema>;

export const BacktestMetricsSchema = z.object({
  returnPercent: z.number().finite(),
  maximumDrawdownPercent: z.number().finite().nonnegative(),
  sharpeLike: z.number().finite(),
  winRatePercent: z.number().finite().min(0).max(100),
  tradeCount: z.number().int().nonnegative(),
  fees: z.string().trim().min(1),
  funding: z.string().trim().min(1),
}).strict();

export const BacktestAssumptionsViewSchema = z.object({
  from: TimestampSchema,
  to: TimestampSchema,
  startingCapital: z.string().trim().min(1),
  feeRateBps: z.number().finite().nonnegative(),
  slippageBps: z.number().finite().nonnegative(),
}).strict().refine((value) => Date.parse(value.from) < Date.parse(value.to), {
  message: 'Backtest start must be before end',
  path: ['to'],
});

export const EquityPointSchema = z.object({
  timestamp: TimestampSchema,
  equity: z.string().trim().min(1),
}).strict();

export const BacktestTradeSchema = z.object({
  traceId: z.string().trim().min(1),
  market: z.string().trim().min(1),
  side: z.enum(['long', 'short']),
  openedAt: TimestampSchema,
  closedAt: TimestampSchema,
  entryPrice: z.string().trim().min(1),
  exitPrice: z.string().trim().min(1),
  realizedPnl: z.string().trim().min(1),
}).strict();

export const TraceOutcomeSchema = z.enum(['executed', 'skipped', 'unknown', 'rejected', 'failed']);

export const TraceSummarySchema = z.object({
  traceId: z.string().trim().min(1),
  outcome: TraceOutcomeSchema,
  occurredAt: TimestampSchema,
  summary: z.string().trim().min(1).max(500),
}).strict();

export type TraceSummary = z.infer<typeof TraceSummarySchema>;

export const BacktestSummarySchema = z.object({
  id: z.string().uuid(),
  botId: BotIdSchema,
  revisionVersion: z.number().int().positive(),
  status: z.enum(['running', 'completed', 'cancelled', 'failed']),
  dataSource: z.literal('Bundled sample data'),
  startedAt: TimestampSchema,
  completedAt: TimestampSchema.nullable(),
  assumptions: BacktestAssumptionsViewSchema,
  metrics: BacktestMetricsSchema,
  equityCurve: z.array(EquityPointSchema),
  trades: z.array(BacktestTradeSchema),
  warnings: z.array(z.string().trim().min(1).max(500)),
  traces: z.array(TraceSummarySchema),
  artifactHash: HashSchema,
}).strict();

export type BacktestSummary = z.infer<typeof BacktestSummarySchema>;

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(),
  z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema),
]));

export const TraceEventViewSchema = z.object({
  sequence: z.number().int().positive(),
  type: z.string().trim().min(1),
  occurredAt: TimestampSchema,
  nodeId: z.string().trim().min(1).optional(),
  summary: z.string().trim().min(1).max(500),
  details: z.record(z.string(), JsonValueSchema),
}).strict();

export const TraceDetailSchema = z.object({
  traceId: z.string().trim().min(1),
  outcome: TraceOutcomeSchema,
  events: z.array(TraceEventViewSchema),
}).strict();

export type TraceDetail = z.infer<typeof TraceDetailSchema>;

export const WorkbenchStateSchema = z.object({
  bot: BotSummarySchema,
  currentRevision: StrategyRevisionSchema.nullable(),
  revisions: z.array(StrategyRevisionSummarySchema),
  messages: z.array(ChatMessageSchema),
  backtests: z.array(BacktestSummarySchema),
}).strict();

export type WorkbenchState = z.infer<typeof WorkbenchStateSchema>;

export const GetWorkbenchInputSchema = z.object({
  botId: BotIdSchema,
  version: z.number().int().positive().optional(),
}).strict();
export const SendWorkbenchMessageInputSchema = z.object({
  botId: BotIdSchema,
  message: z.string().trim().min(1).max(20_000),
}).strict();
export const RunWorkbenchBacktestInputSchema = z.object({
  botId: BotIdSchema,
  revisionVersion: z.number().int().positive(),
  assumptions: BacktestAssumptionsViewSchema,
}).strict();
export const ApproveStrategyRevisionInputSchema = z.object({
  botId: BotIdSchema,
  version: z.number().int().positive(),
}).strict();
export const GetTraceInputSchema = z.object({
  botId: BotIdSchema,
  traceId: z.string().trim().min(1),
}).strict();

export type GetWorkbenchInput = z.infer<typeof GetWorkbenchInputSchema>;
export type SendWorkbenchMessageInput = z.infer<typeof SendWorkbenchMessageInputSchema>;
export type RunWorkbenchBacktestInput = z.infer<typeof RunWorkbenchBacktestInputSchema>;
export type ApproveStrategyRevisionInput = z.infer<typeof ApproveStrategyRevisionInputSchema>;
export type GetTraceInput = z.infer<typeof GetTraceInputSchema>;
