import { useEffect, useState } from 'react';
import { Banner, LayerCard, Tabs } from '@cloudflare/kumo';
import type { AgentToolActivity, BotSummary, CatbotsDesktopApi, StrategyRevision, WorkbenchState } from '@catbots/contracts';

import { ChatPanel } from '../workbench/ChatPanel';
import { BacktestPanel } from '../workbench/BacktestPanel';
import { InspectorPanel } from '../workbench/InspectorPanel';
import { StrategyGraph } from '../workbench/StrategyGraph';
import { WorkbenchHeader } from '../workbench/WorkbenchHeader';

export type BotWorkbenchScreenProps = Readonly<{
  bot: BotSummary;
  api: CatbotsDesktopApi['workbench'];
  onBack(): void;
}>;

export function BotWorkbenchScreen({ bot, api, onBack }: BotWorkbenchScreenProps) {
  const [state, setState] = useState<WorkbenchState | null>(null);
  const [selectedNode, setSelectedNode] = useState<StrategyRevision['nodes'][number] | null>(null);
  const [activity, setActivity] = useState<AgentToolActivity | null>(null);
  const [tab, setTab] = useState('flow');
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState(false);
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

  const send = async (message: string) => {
    setSending(true);
    setError(null);
    try {
      setState(await api.sendMessage({ botId: bot.id, message }));
    } catch {
      setError('Catbots AI could not complete that request. Try again.');
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

  if (state === null) {
    return <section className="workbench-loading" role="status">{error ?? 'Loading bot workspace…'}</section>;
  }
  return (
    <section className="bot-workbench" aria-labelledby="bot-workbench-title">
      <WorkbenchHeader state={state} approving={approving} onBack={onBack} onSelectVersion={(version) => void selectVersion(version)} onApprove={approve} />
      {error === null ? null : <Banner variant="error" title="Workbench unavailable" description={error} />}
      <div className="workbench-grid">
        <ChatPanel messages={state.messages} activity={activity} sending={sending} onSend={send} />
        <section className="workbench-canvas" aria-label="Strategy workspace">
          <Tabs tabs={[{ value: 'flow', label: 'Flow' }, { value: 'backtest', label: 'Backtest' }, { value: 'performance', label: 'Performance' }, { value: 'logs', label: 'Logs' }]} value={tab} onValueChange={setTab} variant="underline" />
          {tab === 'flow' ? (
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
