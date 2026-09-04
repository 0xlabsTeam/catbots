import {
  CreateDraftBotInputSchema,
  ApproveStrategyRevisionInputSchema,
  GetTraceInputSchema,
  GetWorkbenchInputSchema,
  LocalSettingsPatchSchema,
  GetDeploymentInputSchema,
  PauseDeploymentInputSchema,
  REDACTED_SECRET,
  RunWorkbenchBacktestInputSchema,
  SendWorkbenchMessageInputSchema,
  StartPaperInputSchema,
  StopDeploymentInputSchema,
  type AgentToolActivity,
  type BacktestSummary,
  type BotSummary,
  type CatbotsDesktopApi,
  type ChatMessage,
  type RedactedLocalConfig,
  type PaperDeploymentView,
  type StrategyRevision,
  type TraceDetail,
  type WorkbenchState,
} from '@catbots/contracts';

type PreviewWorkbench = {
  revisions: StrategyRevision[];
  messages: ChatMessage[];
  backtests: BacktestSummary[];
  traces: Map<string, TraceDetail>;
};

export function createWebPreviewApi(): CatbotsDesktopApi {
  let config: RedactedLocalConfig | undefined;
  const bots: BotSummary[] = [];
  const workbenches = new Map<string, PreviewWorkbench>();
  const activityListeners = new Set<(activity: AgentToolActivity) => void>();
  const deployments = new Map<string, PaperDeploymentView>();

  const getWorkbench = (botId: string, version?: number): WorkbenchState => {
    const bot = bots.find(({ id }) => id === botId);
    const workbench = workbenches.get(botId);
    if (bot === undefined || workbench === undefined) throw new Error('Preview bot not found');
    const revision = version === undefined
      ? workbench.revisions.at(-1) ?? null
      : workbench.revisions.find((candidate) => candidate.version === version) ?? null;
    if (version !== undefined && revision === null) throw new Error('Preview revision not found');
    return structuredClone({
      bot,
      currentRevision: revision,
      revisions: [...workbench.revisions].reverse().map(({ version: itemVersion, status, createdAt, approvedAt }) => ({ version: itemVersion, status, createdAt, approvedAt })),
      messages: workbench.messages,
      backtests: workbench.backtests,
    });
  };

  const emit = (activity: AgentToolActivity) => {
    for (const listener of activityListeners) listener(activity);
  };

  return {
    app: {
      getVersion: async () => 'web-preview',
      showMainWindow: async () => undefined,
      quitApplication: async () => undefined,
    },
    config: {
      getBootstrapState: async () => config === undefined
        ? { state: 'first-launch' }
        : { state: 'ready', config },
      patchSettings: async (input) => {
        const parsed = LocalSettingsPatchSchema.parse(input);
        config = {
          profile: parsed.profile,
          llm: {
            provider: parsed.llm.provider,
            baseUrl: parsed.llm.baseUrl,
            model: parsed.llm.model,
            apiKey: REDACTED_SECRET,
          },
          exchanges: {},
        };
        return config;
      },
      testLlmConnection: async (input) => {
        const parsed = LocalSettingsPatchSchema.parse(input);
        return { ok: true, model: parsed.llm.model };
      },
    },
    bots: {
      list: async () => [...bots],
      createDraft: async (input) => {
        const parsed = CreateDraftBotInputSchema.parse(input);
        const timestamp = new Date().toISOString();
        const draft: BotSummary = {
          ...parsed,
          id: crypto.randomUUID(),
          status: 'draft',
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        bots.push(draft);
        workbenches.set(draft.id, {
          revisions: [],
          messages: [{ id: crypto.randomUUID(), botId: draft.id, role: 'assistant', content: 'Tell me your trigger, conditions, and action. I will build and validate the visual flow.', createdAt: timestamp }],
          backtests: [],
          traces: new Map(),
        });
        return draft;
      },
    },
    workbench: {
      get: async (input) => {
        const request = GetWorkbenchInputSchema.parse(input);
        return getWorkbench(request.botId, request.version);
      },
      sendMessage: async (input) => {
        const request = SendWorkbenchMessageInputSchema.parse(input);
        const workbench = workbenches.get(request.botId);
        if (workbench === undefined) throw new Error('Preview bot not found');
        const requestId = crypto.randomUUID();
        emit({ botId: request.botId, requestId, phase: 'thinking', message: 'Designing the strategy.' });
        const timestamp = new Date().toISOString();
        workbench.messages.push({ id: crypto.randomUUID(), botId: request.botId, role: 'user', content: request.message, createdAt: timestamp });
        const version = workbench.revisions.length + 1;
        workbench.revisions.push(previewRevision(request.botId, version, timestamp));
        workbench.messages.push({
          id: crypto.randomUUID(),
          botId: request.botId,
          role: 'assistant',
          content: `Draft v${version} is valid. I created an hourly Trigger → combined ETF flow and RSI Conditions → long Action. Run the sample Backtest to inspect performance and every execution trace.`,
          createdAt: timestamp,
        });
        emit({ botId: request.botId, requestId, phase: 'completed', message: 'Agent response completed.' });
        return getWorkbench(request.botId);
      },
      runBacktest: async (input) => {
        const request = RunWorkbenchBacktestInputSchema.parse(input);
        const workbench = workbenches.get(request.botId);
        if (workbench === undefined || !workbench.revisions.some(({ version }) => version === request.revisionVersion)) throw new Error('Preview revision not found');
        const requestId = crypto.randomUUID();
        emit({ botId: request.botId, requestId, phase: 'backtest_progress', tool: 'backtest_strategy', message: 'Backtest is running.', progress: 0.5 });
        const result = previewBacktest(request.botId, request.revisionVersion, request.assumptions);
        workbench.backtests.unshift(result.summary);
        workbench.traces.set(result.trace.traceId, result.trace);
        emit({ botId: request.botId, requestId, phase: 'completed', tool: 'backtest_strategy', message: 'Backtest completed.', progress: 1 });
        return structuredClone(result.summary);
      },
      approveRevision: async (input) => {
        const request = ApproveStrategyRevisionInputSchema.parse(input);
        const workbench = workbenches.get(request.botId);
        const index = workbench?.revisions.findIndex(({ version }) => version === request.version) ?? -1;
        if (workbench === undefined || index < 0) throw new Error('Preview revision not found');
        const approved = { ...workbench.revisions[index]!, status: 'approved' as const, approvedAt: new Date().toISOString() };
        workbench.revisions[index] = approved;
        return structuredClone(approved);
      },
      getTrace: async (input) => {
        const request = GetTraceInputSchema.parse(input);
        const trace = workbenches.get(request.botId)?.traces.get(request.traceId);
        if (trace === undefined) throw new Error('Preview trace not found');
        return structuredClone(trace);
      },
      subscribeActivity: (listener) => {
        activityListeners.add(listener);
        return () => activityListeners.delete(listener);
      },
    },
    deployments: {
      startPaper: async (input) => {
        const request = StartPaperInputSchema.parse(input);
        const workbench = workbenches.get(request.botId);
        const revision = workbench?.revisions.find(({ version }) => version === request.strategyVersion);
        const bot = bots.find(({ id }) => id === request.botId);
        if (revision?.status !== 'approved' || bot === undefined) throw new Error('Preview strategy must be approved');
        const timestamp = new Date().toISOString();
        const id = crypto.randomUUID();
        const view: PaperDeploymentView = {
          deployment: {
            id, botId: request.botId, strategyId: revision.strategyId, strategyVersion: request.strategyVersion,
            mode: 'paper', venue: 'paper', network: 'paper', marketBindings: [bot.market], riskLimits: request.riskLimits,
            status: 'running', createdAt: timestamp, updatedAt: timestamp,
          },
          state: { equityUsd: '10000', positions: [], orders: [] },
          auditEvents: [],
        };
        deployments.set(id, view);
        return structuredClone(view);
      },
      getPaper: async (input) => {
        const request = GetDeploymentInputSchema.parse(input);
        const view = deployments.get(request.deploymentId);
        if (view === undefined) throw new Error('Preview deployment not found');
        return structuredClone(view);
      },
      pausePaper: async (input) => {
        const request = PauseDeploymentInputSchema.parse(input);
        return updatePreviewDeployment(deployments, request.deploymentId, 'paused');
      },
      stopPaper: async (input) => {
        const request = StopDeploymentInputSchema.parse(input);
        return updatePreviewDeployment(deployments, request.deploymentId, 'stopped');
      },
    },
    runtime: {
      getStatus: async () => ({ state: 'stopped', activeBots: 0 }),
      subscribeStatus: () => () => undefined,
    },
  };
}

function updatePreviewDeployment(
  deployments: Map<string, PaperDeploymentView>,
  deploymentId: string,
  status: 'paused' | 'stopped',
): PaperDeploymentView {
  const current = deployments.get(deploymentId);
  if (current === undefined) throw new Error('Preview deployment not found');
  const next: PaperDeploymentView = {
    ...current,
    deployment: { ...current.deployment, status, updatedAt: new Date().toISOString() },
  };
  deployments.set(deploymentId, next);
  return structuredClone(next);
}

function previewRevision(botId: string, version: number, createdAt: string): StrategyRevision {
  return {
    botId,
    strategyId: 'preview-etf-rsi',
    version,
    name: 'BTC ETF Flow + RSI',
    status: 'draft',
    createdAt,
    approvedAt: null,
    nodes: [
      { id: 'hourly', kind: 'trigger', type: 'trigger.interval', version: 1, title: 'Interval', summary: 'Every 1h' },
      { id: 'etf-positive', kind: 'condition', type: 'predicate.compare', version: 1, title: 'Compare', summary: 'BTC ETF daily flow > 0' },
      { id: 'rsi-low', kind: 'condition', type: 'predicate.compare', version: 1, title: 'Compare', summary: 'RSI 14 < 30' },
      { id: 'entry-rules', kind: 'condition', type: 'combine.all', version: 1, title: 'ALL', summary: 'All conditions must pass' },
      { id: 'open-long', kind: 'action', type: 'execution.open_position', version: 1, title: 'Open position', summary: 'Open BTC-PERP long at 10% equity' },
    ],
    edges: [
      { id: 'e1', source: 'hourly', sourcePort: 'activation', target: 'etf-positive', targetPort: 'activation' },
      { id: 'e2', source: 'hourly', sourcePort: 'activation', target: 'rsi-low', targetPort: 'activation' },
      { id: 'e3', source: 'etf-positive', sourcePort: 'result', target: 'entry-rules', targetPort: 'conditions' },
      { id: 'e4', source: 'rsi-low', sourcePort: 'result', target: 'entry-rules', targetPort: 'conditions' },
      { id: 'e5', source: 'entry-rules', sourcePort: 'result', target: 'open-long', targetPort: 'condition' },
    ],
  };
}

function previewBacktest(botId: string, revisionVersion: number, assumptions: BacktestSummary['assumptions']): { summary: BacktestSummary; trace: TraceDetail } {
  const startedAt = new Date().toISOString();
  const traceId = `preview-flow-v${revisionVersion}`;
  const trace: TraceDetail = {
    traceId,
    outcome: 'executed',
    events: [
      { sequence: 1, type: 'trigger.received', occurredAt: assumptions.from, nodeId: 'hourly', summary: 'hourly trigger received', details: {} },
      { sequence: 2, type: 'condition.evaluated', occurredAt: assumptions.from, nodeId: 'entry-rules', summary: 'all entry conditions passed', details: { result: true } },
      { sequence: 3, type: 'flow.completed', occurredAt: assumptions.from, nodeId: 'open-long', summary: 'sample order flow completed', details: { mode: 'backtest' } },
    ],
  };
  return {
    trace,
    summary: {
      id: crypto.randomUUID(),
      botId,
      revisionVersion,
      status: 'completed',
      dataSource: 'Bundled sample data',
      startedAt,
      completedAt: new Date().toISOString(),
      assumptions,
      metrics: { returnPercent: 4.2, maximumDrawdownPercent: 1.1, sharpeLike: 1.4, winRatePercent: 60, tradeCount: 5, fees: '12.34', funding: '-1.25' },
      equityCurve: [
        { timestamp: assumptions.from, equity: assumptions.startingCapital },
        { timestamp: assumptions.to, equity: String(Number(assumptions.startingCapital) * 1.042) },
      ],
      trades: [],
      warnings: ['Bundled sample data is synthetic and is not live market data.'],
      traces: [{ traceId, outcome: 'executed', occurredAt: assumptions.from, summary: 'sample order flow completed' }],
      artifactHash: `sha256:${'b'.repeat(64)}`,
    },
  };
}
