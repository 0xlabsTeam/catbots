import { randomUUID } from 'node:crypto';
import { DeploymentSchema, StartPaperInputSchema, type Deployment, type StartPaperInput } from '@catbots/contracts';
import {
  createBuiltinRegistry,
  createEvaluationContext,
  evaluateTrigger,
  validateStrategy,
  type AuditEvent,
  type CompiledStrategy,
  type EvaluationContext,
  type TriggerInput,
} from '@catbots/strategy-runtime';

import type { WorkbenchRepository } from '../workbench/workbench-repository';
import type { ExecutionRepository } from './execution-repository';
import { PaperAdapter, type PaperState } from './paper-adapter';

type ActivePaperDeployment = Readonly<{
  deployment: Deployment;
  compiled: CompiledStrategy;
  adapter: PaperAdapter;
  evaluations: Map<string, readonly AuditEvent[]>;
}>;

export type PaperIngestInput = Readonly<{
  deploymentId: string;
  triggerNodeId: string;
  triggerInput: TriggerInput;
  context: EvaluationContext;
}>;

export type PaperEvaluationResult = Readonly<{
  traceId: string;
  duplicate: boolean;
  events: readonly AuditEvent[];
  state: PaperState;
}>;

export class DeploymentService {
  private readonly active = new Map<string, ActivePaperDeployment>();

  constructor(private readonly dependencies: Readonly<{
    executionRepository: ExecutionRepository;
    workbenchRepository: Pick<WorkbenchRepository, 'getState' | 'getStrategyDocument'>;
    clock?: () => Date;
    idFactory?: () => string;
  }>) {}

  startPaper(source: StartPaperInput): Deployment {
    const input = StartPaperInputSchema.parse(source);
    const state = this.dependencies.workbenchRepository.getState(input.botId, input.strategyVersion);
    if (state.currentRevision?.status !== 'approved') throw new Error('Paper deployment requires an approved strategy revision');
    const document = this.dependencies.workbenchRepository.getStrategyDocument(input.botId, input.strategyVersion);
    const validation = validateStrategy(document, createBuiltinRegistry());
    if (!validation.valid) throw new Error('Approved strategy is no longer valid');
    const timestamp = (this.dependencies.clock ?? (() => new Date()))().toISOString();
    const deployment = DeploymentSchema.parse({
      id: (this.dependencies.idFactory ?? randomUUID)(),
      botId: input.botId,
      strategyId: document.strategy.id,
      strategyVersion: input.strategyVersion,
      mode: 'paper',
      venue: 'paper',
      network: 'paper',
      marketBindings: [state.bot.market],
      riskLimits: input.riskLimits,
      status: 'running',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const persisted = this.dependencies.executionRepository.createDeployment(deployment);
    this.active.set(persisted.id, {
      deployment: persisted,
      compiled: validation.compiled,
      adapter: new PaperAdapter({
        deploymentId: persisted.id,
        strategyId: persisted.strategyId,
        strategyVersion: persisted.strategyVersion,
        market: persisted.marketBindings[0]!,
        riskLimits: persisted.riskLimits,
      }),
      evaluations: new Map(),
    });
    return persisted;
  }

  ingest(input: PaperIngestInput): PaperEvaluationResult {
    const runtime = this.active.get(input.deploymentId);
    if (runtime === undefined || this.dependencies.executionRepository.getDeployment(input.deploymentId).status !== 'running') {
      throw new Error('Paper deployment is not running');
    }
    runtime.adapter.beginEvaluation();
    try {
      const paperState = runtime.adapter.snapshot();
      const context = createEvaluationContext({
        ...input.context,
        values: {
          ...input.context.values,
          'account.positions': {
            value: paperState.positions,
            provider: 'catbots.paper',
            observedAt: input.context.evaluatedAt,
            freshnessSeconds: 0,
            quality: { status: 'verified' },
            integrityHash: `paper:${runtime.deployment.id}:positions:${paperState.orders.length}`,
          },
        },
      });
      const evaluation = evaluateTrigger({
        compiled: runtime.compiled,
        triggerNodeId: input.triggerNodeId,
        triggerInput: input.triggerInput,
        context,
        deployment: { id: runtime.deployment.id, mode: 'paper' },
        execution: runtime.adapter,
      });
      const previous = runtime.evaluations.get(evaluation.traceId);
      if (previous !== undefined || this.dependencies.executionRepository.hasTrace(evaluation.traceId)) {
        runtime.adapter.rollbackEvaluation();
        return {
          traceId: evaluation.traceId,
          duplicate: true,
          events: previous ?? evaluation.trace,
          state: runtime.adapter.snapshot(),
        };
      }
      this.dependencies.executionRepository.recordPaperTrace(runtime.deployment.id, evaluation.trace);
      runtime.adapter.commitEvaluation();
      runtime.evaluations.set(evaluation.traceId, evaluation.trace);
      return { traceId: evaluation.traceId, duplicate: false, events: evaluation.trace, state: runtime.adapter.snapshot() };
    } catch (error) {
      runtime.adapter.rollbackEvaluation();
      throw error;
    }
  }

  getPaperState(deploymentId: string): PaperState {
    const runtime = this.active.get(deploymentId);
    if (runtime === undefined) throw new Error('Paper deployment is not active');
    return runtime.adapter.snapshot();
  }

  pause(deploymentId: string): Deployment {
    const timestamp = (this.dependencies.clock ?? (() => new Date()))().toISOString();
    return this.dependencies.executionRepository.pause(deploymentId, timestamp);
  }

  stop(deploymentId: string): Deployment {
    const timestamp = (this.dependencies.clock ?? (() => new Date()))().toISOString();
    this.dependencies.executionRepository.requestStop(deploymentId, timestamp);
    this.active.delete(deploymentId);
    return this.dependencies.executionRepository.completeStop(deploymentId, timestamp);
  }
}
