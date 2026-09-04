import { z } from 'zod';

const BotIdSchema = z.string().uuid();
const DeploymentIdSchema = z.string().uuid();
const TimestampSchema = z.string().datetime();
const NonEmptyTextSchema = z.string().trim().min(1);

export const PositiveDecimalStringSchema = z.string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, 'Must be greater than zero');

const UniqueMarketsSchema = z.array(z.string().trim().min(1).max(40)).min(1).refine(
  (markets) => new Set(markets).size === markets.length,
  'Markets must be unique',
);

export const RiskLimitsSchema = z.object({
  maxOrderUsd: PositiveDecimalStringSchema,
  maxPositionUsd: PositiveDecimalStringSchema,
  maxLeverage: z.number().int().min(1).max(50),
  maxDailyLossUsd: PositiveDecimalStringSchema,
  maxDrawdownPercent: z.number().finite().positive().max(100),
  allowedMarkets: UniqueMarketsSchema,
  allowedSides: z.array(z.enum(['long', 'short'])).min(1).refine(
    (sides) => new Set(sides).size === sides.length,
    'Sides must be unique',
  ),
  maxOrdersPerMinute: z.number().int().positive().max(600),
}).strict();

export type RiskLimits = z.infer<typeof RiskLimitsSchema>;

const DeploymentBaseSchema = z.object({
  id: DeploymentIdSchema,
  botId: BotIdSchema,
  strategyId: NonEmptyTextSchema.max(120),
  strategyVersion: z.number().int().positive(),
  marketBindings: UniqueMarketsSchema,
  riskLimits: RiskLimitsSchema,
  status: z.enum(['preflight', 'running', 'paused', 'stopping', 'stopped', 'recovering', 'suspended', 'error']),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();

export const DeploymentSchema = z.discriminatedUnion('mode', [
  DeploymentBaseSchema.extend({
    mode: z.literal('paper'),
    venue: z.literal('paper'),
    network: z.literal('paper'),
  }).strict(),
  DeploymentBaseSchema.extend({
    mode: z.literal('live'),
    venue: z.literal('hyperliquid'),
    network: z.literal('testnet'),
    maskedAccount: NonEmptyTextSchema.max(80),
  }).strict(),
]);

export type Deployment = z.infer<typeof DeploymentSchema>;

export const StartPaperInputSchema = z.object({
  botId: BotIdSchema,
  strategyVersion: z.number().int().positive(),
  riskLimits: RiskLimitsSchema,
}).strict();

export const PrepareLiveInputSchema = z.object({
  botId: BotIdSchema,
  strategyVersion: z.number().int().positive(),
  riskLimits: RiskLimitsSchema,
  network: z.literal('testnet'),
}).strict();

export const StartLiveInputSchema = PrepareLiveInputSchema.extend({
  confirmationBotName: NonEmptyTextSchema.max(80),
  preflightId: DeploymentIdSchema,
}).strict();

export const StopDeploymentInputSchema = z.object({
  deploymentId: DeploymentIdSchema,
}).strict();

export type StartPaperInput = z.infer<typeof StartPaperInputSchema>;
export type PrepareLiveInput = z.infer<typeof PrepareLiveInputSchema>;
export type StartLiveInput = z.infer<typeof StartLiveInputSchema>;
export type StopDeploymentInput = z.infer<typeof StopDeploymentInputSchema>;

export const LivePreflightCheckIdSchema = z.enum([
  'connection',
  'network',
  'agent-wallet',
  'account-balance',
  'risk-limits',
  'strategy',
  'backtest',
  'data-freshness',
  'audit-storage',
  'runtime',
  'reconciliation',
]);

export const LivePreflightCheckSchema = z.object({
  id: LivePreflightCheckIdSchema,
  label: NonEmptyTextSchema.max(120),
  ok: z.boolean(),
  message: NonEmptyTextSchema.max(500),
  repairTarget: z.enum(['settings', 'strategy', 'backtest', 'risk', 'runtime']).optional(),
}).strict();

export const LivePreflightViewSchema = z.object({
  id: DeploymentIdSchema,
  botId: BotIdSchema,
  strategyVersion: z.number().int().positive(),
  network: z.literal('testnet'),
  maskedAccount: NonEmptyTextSchema.max(80),
  checkedAt: TimestampSchema,
  ready: z.boolean(),
  checks: z.array(LivePreflightCheckSchema).min(1),
}).strict().superRefine((value, context) => {
  const allChecksPassed = value.checks.every(({ ok }) => ok);
  if (value.ready !== allChecksPassed) {
    context.addIssue({ code: 'custom', path: ['ready'], message: 'Ready must match the preflight checks' });
  }
});

export type LivePreflightView = z.infer<typeof LivePreflightViewSchema>;

export const AuditEventTypeSchema = z.enum([
  'trigger.received',
  'context.resolution_started',
  'context.resolved',
  'context.failed',
  'condition.evaluated',
  'action.proposed',
  'risk.approved',
  'risk.rejected',
  'execution.queued',
  'execution.submitted',
  'execution.acknowledged',
  'execution.rejected',
  'execution.partially_filled',
  'execution.filled',
  'execution.cancelled',
  'flow.skipped',
  'flow.completed',
  'flow.failed',
]);

const SanitizedAdapterMetadataSchema = z.object({
  venue: z.literal('hyperliquid'),
  requestId: NonEmptyTextSchema.max(120),
  statusCode: z.number().int().min(100).max(599).optional(),
  venueOrderId: NonEmptyTextSchema.max(120).optional(),
  retryCount: z.number().int().nonnegative().optional(),
  errorCode: NonEmptyTextSchema.max(120).optional(),
}).strict();

export const AuditEventViewSchema = z.object({
  id: z.string().uuid(),
  traceId: NonEmptyTextSchema.max(120),
  sequence: z.number().int().positive(),
  type: AuditEventTypeSchema,
  occurredAt: TimestampSchema,
  strategyId: NonEmptyTextSchema.max(120),
  strategyVersion: z.number().int().positive(),
  deploymentId: DeploymentIdSchema,
  mode: z.enum(['paper', 'live']),
  nodeId: NonEmptyTextSchema.max(120).optional(),
  nodeType: NonEmptyTextSchema.max(120).optional(),
  summary: NonEmptyTextSchema.max(500),
  riskRuleIds: z.array(NonEmptyTextSchema.max(120)),
  adapter: SanitizedAdapterMetadataSchema.optional(),
}).strict();

export type AuditEventView = z.infer<typeof AuditEventViewSchema>;
