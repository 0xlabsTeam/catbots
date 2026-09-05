import { useEffect, useState } from 'react';
import { Badge, Banner, Button, LayerCard, Tabs } from '@cloudflare/kumo';
import type { AgentToolActivity, AuditEventView, BotSummary, CatbotsDesktopApi, Deployment, PaperDeploymentView, RiskLimits, StrategyRevision, TraceDetail, TraceSummary, WorkbenchState } from '@catbots/contracts';
import { toRendererSafeTraceDetails } from '../../shared/trace-projection';

import { ChatPanel } from '../workbench/ChatPanel';
import { BacktestPanel } from '../workbench/BacktestPanel';
import { TraceTimeline } from '../workbench/TraceTimeline';
import { InspectorPanel } from '../workbench/InspectorPanel';
import { StrategyGraph } from '../workbench/StrategyGraph';
import { WorkbenchHeader } from '../workbench/WorkbenchHeader';
import { isDynamicDeploymentEligible } from '../workbench/DeploymentScopeSummary';
import { LiveReviewScreen } from './LiveReviewScreen';
import { PaperReviewScreen } from './PaperReviewScreen';

export type BotWorkbenchScreenProps = Readonly<{
  bot: BotSummary;
  api: CatbotsDesktopApi['workbench'];
  deploymentApi: CatbotsDesktopApi['deployments'];
  onBack(): void;
  onOpenSettings?(): void;
}>;

export function BotWorkbenchScreen({ bot, api, deploymentApi, onBack, onOpenSettings }: BotWorkbenchScreenProps) {
  const [state, setState] = useState<WorkbenchState | null>(null);
  const [selectedNode, setSelectedNode] = useState<StrategyRevision['nodes'][number] | null>(null);
  const [activity, setActivity] = useState<AgentToolActivity | null>(null);
  const [tab, setTab] = useState('flow');
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState(false);
  const [deployment, setDeployment] = useState<PaperDeploymentView | null>(null);
  const [liveDeployment, setLiveDeployment] = useState<Deployment | null>(null);
  const [reviewingPaper, setReviewingPaper] = useState(false);
  const [reviewingLive, setReviewingLive] = useState(false);
  const [changingDeployment, setChangingDeployment] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.get({ botId: bot.id }).then((next) => { if (active) setState(next); }).catch(() => { if (active) setError('We could not load this bot workspace.'); });
    const unsubscribe = api.subscribeActivity((next) => {
      if (next.botId !== bot.id) return;
      setActivity(next.phase === 'completed' || next.phase === 'failed' ? null : next);
    });
    return () => { active = false; unsubscribe(); };
  }, [api, bot.id]);

  useEffect(() => {
    let active = true;
    void deploymentApi.getActive({ botId: bot.id }).then(async (current) => {
      if (!active || current === null) return;
      if (current.mode === 'live') {
        setLiveDeployment(current);
        return;
      }
      try {
        const paper = await deploymentApi.getPaper({ deploymentId: current.id });
        if (active) setDeployment(paper);
      } catch {
        if (active) setError('Paper deployment records could not be loaded.');
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [bot.id, deploymentApi]);

  useEffect(() => {
    if (deployment?.deployment.status !== 'running') return;
    const deploymentId = deployment.deployment.id;
    const timer = window.setInterval(() => {
      void deploymentApi.getPaper({ deploymentId }).then(setDeployment).catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [deployment?.deployment.id, deployment?.deployment.status, deploymentApi]);

  const send = async (message: string) => {
    setSending(true);
    setError(null);
    try {
      setState(await api.sendMessage({ botId: bot.id, message }));
    } catch {
      setError('Catbots AI could not complete that request. Try again.');
      throw new Error('WORKBENCH_MESSAGE_FAILED');
    } finally {
      setSending(false);
    }
  };
  const selectVersion = async (version: number) => {
    setError(null);
    try {
      const next = await api.get({ botId: bot.id, version });
      setState(next);
      setSelectedNode(null);
    } catch {
      setError('That strategy version could not be loaded.');
    }
  };
  const approve = async () => {
    if (state?.currentRevision === null || state?.currentRevision === undefined) return;
    setApproving(true);
    setError(null);
    try {
      const approved = await api.approveRevision({ botId: bot.id, version: state.currentRevision.version });
      setState((previous) => previous === null ? previous : {
        ...previous,
        currentRevision: approved,
        revisions: previous.revisions.map((revision) => revision.version === approved.version
          ? { version: approved.version, status: approved.status, createdAt: approved.createdAt, approvedAt: approved.approvedAt }
          : revision),
      });
    } catch {
      setError('This strategy revision could not be approved.');
    } finally {
      setApproving(false);
    }
  };
  const startPaper = async (riskLimits: RiskLimits) => {
    const revision = state?.currentRevision;
    if (!isDynamicDeploymentEligible(revision)) return;
    setChangingDeployment(true);
    setError(null);
    try {
      setDeployment(await deploymentApi.startPaper({
        botId: bot.id,
        strategyVersion: revision.version,
        riskLimits,
      }));
      setReviewingPaper(false);
    } catch {
      setError('Paper deployment could not start. Check approval and risk limits.');
      throw new Error('PAPER_DEPLOYMENT_FAILED');
    } finally {
      setChangingDeployment(false);
    }
  };
  const changePaperStatus = async (action: 'pause' | 'stop') => {
    if (deployment === null) return;
    setChangingDeployment(true);
    setError(null);
    try {
      const input = { deploymentId: deployment.deployment.id };
      setDeployment(await (action === 'pause' ? deploymentApi.pausePaper(input) : deploymentApi.stopPaper(input)));
    } catch {
      setError(`Paper deployment could not ${action}.`);
    } finally {
      setChangingDeployment(false);
    }
  };
  const stopLive = async () => {
    if (liveDeployment?.mode !== 'live') return;
    setChangingDeployment(true);
    setError(null);
    try {
      setLiveDeployment(await deploymentApi.stopLive({ deploymentId: liveDeployment.id }));
    } catch {
      setError('Live deployment could not stop. Check runtime status immediately.');
    } finally {
      setChangingDeployment(false);
    }
  };

  if (state === null) {
    return <section className="workbench-loading" role="status">{error ?? 'Loading bot workspace…'}</section>;
  }
  if (reviewingLive && isDynamicDeploymentEligible(state.currentRevision)) {
    return <LiveReviewScreen
      bot={bot}
      revision={state.currentRevision}
      riskLimits={defaultRiskLimits()}
      api={deploymentApi}
      onBack={() => setReviewingLive(false)}
      onRunPaper={() => { setReviewingLive(false); setReviewingPaper(true); }}
      onStarted={(next) => { setLiveDeployment(next); setReviewingLive(false); }}
      onOpenSettings={onOpenSettings}
    />;
  }
  if (reviewingPaper && isDynamicDeploymentEligible(state.currentRevision)) {
    return <PaperReviewScreen
      bot={bot}
      revision={state.currentRevision}
      initialRiskLimits={defaultRiskLimits()}
      onCancel={() => setReviewingPaper(false)}
      onStart={startPaper}
    />;
  }
  return (
    <section className="bot-workbench" aria-labelledby="bot-workbench-title">
      <WorkbenchHeader state={state} approving={approving} onBack={onBack} onSelectVersion={(version) => void selectVersion(version)} onApprove={approve} />
      {error === null ? null : <Banner variant="error" title="Workbench unavailable" description={error} />}
      <div className="workbench-grid">
        <ChatPanel messages={state.messages} activity={activity} sending={sending} onSend={send} />
        <section className="workbench-canvas" aria-label="Strategy workspace">
          <ExecutionControls
            revision={state.currentRevision}
            deployment={deployment}
            liveDeployment={liveDeployment}
            changing={changingDeployment}
            onStart={() => setReviewingPaper(true)}
            onPause={() => void changePaperStatus('pause')}
            onStop={() => void changePaperStatus('stop')}
            onReviewLive={() => setReviewingLive(true)}
            onStopLive={() => void stopLive()}
          />
          <Tabs tabs={[{ value: 'flow', label: 'Flow' }, { value: 'backtest', label: 'Backtest' }, { value: 'performance', label: 'Performance' }, { value: 'logs', label: 'Logs' }]} value={tab} onValueChange={setTab} variant="underline" />
          {tab === 'performance' ? <PaperPerformance deployment={deployment} />
            : tab === 'logs' ? <PaperLogs deployment={deployment} />
            : tab === 'flow' ? (
            state.currentRevision === null
              ? <LayerCard className="workbench-empty"><h2>Start with a requirement</h2><p>Tell Catbots AI when to evaluate, which conditions to combine, and what action to take.</p></LayerCard>
              : <StrategyGraph revision={state.currentRevision} onSelectNode={setSelectedNode} />
          ) : state.currentRevision === null
            ? <LayerCard className="workbench-empty"><h2>Create a strategy first</h2><p>A valid revision is required before a Backtest can run.</p></LayerCard>
            : <BacktestPanel
                key={state.currentRevision.version}
                botId={bot.id}
                revision={state.currentRevision}
                backtests={state.backtests.filter(({ revisionVersion }) => revisionVersion === state.currentRevision?.version)}
                api={api}
                onCompleted={(backtest) => setState((previous) => previous === null ? previous : { ...previous, backtests: [backtest, ...previous.backtests] })}
              />}
        </section>
        <InspectorPanel node={selectedNode} />
      </div>
    </section>
  );
}

function ExecutionControls({ revision, deployment, liveDeployment, changing, onStart, onPause, onStop, onReviewLive, onStopLive }: Readonly<{
  revision: StrategyRevision | null;
  deployment: PaperDeploymentView | null;
  liveDeployment: Deployment | null;
  changing: boolean;
  onStart(): void;
  onPause(): void;
  onStop(): void;
  onReviewLive(): void;
  onStopLive(): void;
}>) {
  const status = deployment?.deployment.status;
  const liveStatus = liveDeployment?.mode === 'live' ? liveDeployment.status : undefined;
  const canReviewDeployment = isDynamicDeploymentEligible(revision);
  const legacyApproved = revision?.status === 'approved' && !canReviewDeployment;
  return (
    <LayerCard className="paper-controls">
      <div>
        <p className="eyebrow">EXECUTION</p>
        <strong>{liveStatus === 'running' ? 'Live deployment is running' : status === undefined ? 'Paper is stopped'
          : deployment?.state === null && status !== 'stopped' ? 'Paper runtime unavailable' : `Paper deployment is ${status}`}</strong>
        <p>{liveStatus === 'running' ? 'Hyperliquid testnet · risk checks and every flow event are logged.' : 'Local simulation · risk checks and every flow event are logged.'}</p>
      </div>
      <div className="paper-control-actions">
        {legacyApproved ? <div className="deployment-upgrade-note"><Badge variant="info">Upgrade required</Badge><span>Create and approve a Strategy 2.0 dynamic-market revision in Chat.</span></div> : null}
        {status === 'running' && deployment?.state !== null ? <Badge variant="success">Paper running</Badge> : null}
        {liveStatus === 'running' ? <Badge variant="error">Live · Hyperliquid testnet</Badge> : null}
        {(status === undefined || status === 'stopped') && canReviewDeployment
          ? <Button type="button" variant="primary" loading={changing} onClick={onStart}>Run Paper</Button>
          : null}
        {status === 'running' ? <Button type="button" variant="secondary" disabled={changing} onClick={onPause}>Pause</Button> : null}
        {status === 'running' || status === 'paused'
          ? <Button type="button" variant="destructive" disabled={changing} onClick={onStop}>Stop</Button>
          : null}
        {canReviewDeployment && liveStatus !== 'running'
          ? <Button type="button" variant="secondary" disabled={changing || status === 'running'} onClick={onReviewLive}>Review Live</Button>
          : null}
        {liveStatus === 'running'
          ? <Button type="button" variant="destructive" disabled={changing} onClick={onStopLive}>Stop Live</Button>
          : null}
      </div>
    </LayerCard>
  );
}

function PaperPerformance({ deployment }: { deployment: PaperDeploymentView | null }) {
  if (deployment === null) return <EmptyPaper title="No Paper run yet" description="Approve this strategy and run it in Paper mode to see execution performance." />;
  if (deployment.state === null) return <EmptyPaper title="Paper runtime unavailable" description="Positions and orders were not restored. Durable deployment records and logs remain available." />;
  return (
    <LayerCard className="paper-performance">
      <p className="eyebrow">PAPER PERFORMANCE</p>
      <div className="paper-metrics">
        <Metric label="Equity" value={formatUsd(deployment.state.equityUsd)} />
        <Metric label="Open positions" value={String(deployment.state.positions.length)} />
        <Metric label="Filled orders" value={String(deployment.state.orders.length)} />
        <Metric label="Audit events" value={String(deployment.auditEvents.length)} />
      </div>
    </LayerCard>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function PaperLogs({ deployment }: { deployment: PaperDeploymentView | null }) {
  if (deployment === null) return <EmptyPaper title="No execution logs" description="Paper flow events will appear here after a run starts." />;
  if (deployment.auditEvents.length === 0) return deployment.state === null
    ? <EmptyPaper title="No recorded execution logs" description="The Paper runtime is unavailable after restart." />
    : <EmptyPaper title="Paper is ready" description="Waiting for the first trigger." />;
  const children = new Map<string, AuditEventView[]>();
  for (const event of deployment.auditEvents) {
    if (event.market === undefined && event.parentTraceId === undefined
      && deployment.auditEvents.some((child) => child.parentTraceId === event.traceId)) continue;
    children.set(event.traceId, [...(children.get(event.traceId) ?? []), event]);
  }
  const traces: TraceSummary[] = [...children].map(([traceId, events]) => {
    const first = events[0]!;
    const types = new Set(events.map(({ type }) => type));
    return {
      traceId, parentTraceId: first.parentTraceId ?? null, market: first.market ?? null,
      ...(first.universeRevision === undefined ? {} : { universeRevision: first.universeRevision }),
      occurredAt: first.occurredAt, summary: events.at(-1)!.type.replaceAll('.', ' '),
      outcome: types.has('flow.failed') ? 'failed' : types.has('risk.rejected') ? 'rejected'
        : types.has('flow.skipped') ? 'skipped' : types.has('execution.filled') ? 'executed' : 'unknown',
    };
  });
  return <TraceTimeline backtestId={deployment.deployment.id} botId={deployment.deployment.botId}
    revisionVersion={deployment.deployment.strategyVersion} traces={traces} api={{
      getTrace: async ({ traceId }): Promise<TraceDetail> => {
        const trace = traces.find((candidate) => candidate.traceId === traceId);
        if (trace === undefined) throw new Error('Trace unavailable');
        return { traceId, parentTraceId: trace.parentTraceId, market: trace.market, outcome: trace.outcome,
          events: children.get(traceId)!.map((event) => ({
            sequence: event.sequence, type: event.type, occurredAt: event.occurredAt,
            ...(event.nodeId === undefined ? {} : { nodeId: event.nodeId }), summary: event.type.replaceAll('.', ' '),
            details: toRendererSafeTraceDetails(event.type, { ...event.condition, effect: event.effect, riskRuleIds: event.riskRuleIds }),
          })),
        };
      },
    }} />;
}

function EmptyPaper({ title, description }: { title: string; description: string }) {
  return <LayerCard className="workbench-empty"><h2>{title}</h2><p>{description}</p></LayerCard>;
}

function defaultRiskLimits(): RiskLimits {
  return {
    maxOrderUsd: '1000', maxPositionUsd: '2500', maxLeverage: 3,
    maxTotalExposureUsd: '5000',
    maxDailyLossUsd: '300', maxDrawdownPercent: 12,
    allowedSides: ['long', 'short'], maxOrdersPerMinute: 4,
  };
}

function formatUsd(value: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value));
}
