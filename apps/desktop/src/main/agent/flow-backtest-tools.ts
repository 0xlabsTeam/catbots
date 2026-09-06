import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { FlowBacktestSettingsSchema, type FlowBacktestJob } from '@catbots/contracts';

export const flowBacktestNames = ['run_flow_backtest', 'get_flow_backtest', 'cancel_flow_backtest'] as const;
export const runFlowArguments = z.object({ version: z.number().int().positive(), settings: FlowBacktestSettingsSchema, refresh: z.boolean().default(false) }).strict();
export const getFlowArguments = z.object({ jobId: z.string().uuid(), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(20) }).strict();
export const cancelFlowArguments = z.object({ jobId: z.string().uuid() }).strict();
export type BacktestCommand = (input: unknown) => { backtest: FlowBacktestJob };

// Bound tool output: full candles, documents and equity series stay in the backend.
export function backtestView(job: FlowBacktestJob, offset = 0, limit = 20) {
  const { result, ...status } = job;
  if (!result) return { ok: job.status !== 'failed', ...status };
  const { document: _document, equityCurve: _curve, fills, ...metrics } = result;
  return { ok: true, ...status, result: { ...metrics, fillCount: fills.length, fills: fills.slice(offset, offset + limit), offset, nextOffset: offset + limit < fills.length ? offset + limit : null } };
}

export function createFlowBacktestTools(botId: string, command?: BacktestCommand, progress?: (job: FlowBacktestJob) => void) {
  let runs = 0;
  return async (name: string, args: unknown, signal: AbortSignal) => {
    try {
      signal.throwIfAborted();
      if (!command) throw new Error('Historical backtest service unavailable');
      if (name === 'get_flow_backtest') {
        const input = getFlowArguments.parse(args);
        return backtestView(command({ action: 'backtest_status', botId, jobId: input.jobId }).backtest, input.offset, input.limit);
      }
      if (name === 'cancel_flow_backtest') {
        const input = cancelFlowArguments.parse(args);
        return backtestView(command({ action: 'cancel_backtest', botId, jobId: input.jobId }).backtest);
      }
      if (name !== 'run_flow_backtest') throw new Error('Unknown backtest tool');
      const input = runFlowArguments.parse(args);
      if (runs >= 5) throw new Error('Five backtests per message limit reached. Summarize the evidence and remaining work.');
      let job = command({ action: 'backtest_flow', botId, ...input }).backtest;
      runs++;
      const deadline = Date.now() + 180_000;
      try {
        while (job.status === 'loading' || job.status === 'running') {
          progress?.(job);
          if (Date.now() >= deadline) return backtestView(job);
          await delay(500, undefined, { signal });
          job = command({ action: 'backtest_status', botId, jobId: job.id }).backtest;
        }
        progress?.(job);
        return backtestView(job);
      } catch (error) {
        if (signal.aborted) command({ action: 'cancel_backtest', botId, jobId: job.id });
        throw error;
      }
    } catch (error) {
      return { ok: false, error: signal.aborted ? 'Backtest cancelled' : error instanceof Error ? error.message : 'Backtest failed' };
    }
  };
}
