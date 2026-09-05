import { useEffect, useState } from 'react';
import { Badge, Banner, Button, Input, LayerCard } from '@cloudflare/kumo';
import { CheckCircleIcon, WarningDiamondIcon, XCircleIcon } from '@phosphor-icons/react';
import type { BotSummary, CatbotsDesktopApi, Deployment, LivePreflightView, RiskLimits, StrategyRevision } from '@catbots/contracts';

import { DeploymentScopeSummary, isDynamicDeploymentEligible } from '../workbench/DeploymentScopeSummary';

export type LiveReviewScreenProps = Readonly<{
  bot: BotSummary;
  revision: StrategyRevision;
  riskLimits: RiskLimits;
  api: CatbotsDesktopApi['deployments'];
  onBack(): void;
  onRunPaper(): void;
  onStarted(deployment: Deployment): void;
  onOpenSettings?(): void;
}>;

export function LiveReviewScreen({ bot, revision, riskLimits, api, onBack, onRunPaper, onStarted, onOpenSettings }: LiveReviewScreenProps) {
  const [preflight, setPreflight] = useState<LivePreflightView | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [preparing, setPreparing] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDynamicDeploymentEligible(revision)) return;
    let active = true;
    setPreparing(true);
    void api.prepareLive({ botId: bot.id, strategyVersion: revision.version, network: 'testnet', riskLimits })
      .then((value) => { if (active) setPreflight(value); })
      .catch(() => { if (active) setError('Live preflight could not be completed.'); })
      .finally(() => { if (active) setPreparing(false); });
    return () => { active = false; };
  }, [api, bot.id, revision, riskLimits]);

  const start = async () => {
    if (preflight?.ready !== true || confirmation !== bot.name) return;
    setStarting(true);
    setError(null);
    try {
      onStarted(await api.startLive({
        botId: bot.id,
        strategyVersion: revision.version,
        network: 'testnet',
        riskLimits,
        confirmationBotName: confirmation,
        preflightId: preflight.id,
      }));
    } catch {
      setError('Live deployment did not start. Run preflight again and review failed checks.');
    } finally {
      setStarting(false);
    }
  };

  const canStart = preflight?.ready === true && confirmation === bot.name && !starting;
  const failedChecks = preflight?.checks.filter(({ ok }) => !ok) ?? [];
  const freshnessCheck = preflight?.checks.find(({ id }) => id === 'data-freshness');
  const freshnessSummary = preparing
    ? 'Universe data: Checking freshness…'
    : freshnessCheck?.ok === true
      ? `Universe data is fresh. ${freshnessCheck.message}`
      : `Universe data is stale or unavailable. ${freshnessCheck?.message ?? 'Freshness was not reported.'}`;
  if (!isDynamicDeploymentEligible(revision)) {
    return (
      <main className="live-review" aria-labelledby="live-upgrade-title">
        <header className="live-review-header">
          <div><p className="eyebrow">LIVE EXECUTION SAFETY GATE</p><h1 id="live-upgrade-title">Upgrade required for Live</h1></div>
          <Button type="button" variant="secondary" onClick={onBack}>Back to bot</Button>
        </header>
        <LayerCard className="live-review-section deployment-upgrade-card">
          <h2>Strategy 2.0 dynamic scope required</h2>
          <DeploymentScopeSummary dex={bot.dex} revision={revision} freshness="Universe data freshness is unavailable for this legacy revision." />
          <p>Create and approve a Strategy 2.0 dynamic-market revision in Chat before reviewing Live deployment.</p>
        </LayerCard>
      </main>
    );
  }
  return (
    <main className="live-review" aria-labelledby="live-review-title">
      <header className="live-review-header">
        <div>
          <p className="eyebrow">LIVE EXECUTION SAFETY GATE</p>
          <h1 id="live-review-title">Review Live deployment</h1>
          <p>Confirm the connection, immutable strategy revision, risk limits, and testnet account before any order can be submitted.</p>
        </div>
        <div className="live-review-heading-actions">
          <Button type="button" variant="secondary" onClick={onBack}>Back to bot</Button>
          <Badge variant="error"><WarningDiamondIcon aria-hidden="true" weight="fill" /> Live</Badge>
        </div>
      </header>
      {error === null ? null : <Banner variant="error" title="Live review unavailable" description={error} />}
      <div className="live-review-grid">
        <div className="live-review-main">
          <ReviewSection eyebrow="1 · CONNECTION" title="Hyperliquid testnet">
            <DefinitionList rows={[
              ['Venue', 'Hyperliquid'], ['Network', 'Testnet only'], ['Account', preflight?.maskedAccount ?? 'Checking…'],
            ]} />
          </ReviewSection>
          <ReviewSection eyebrow="2 · STRATEGY" title={`${revision.name} · v${revision.version}`}>
            <DeploymentScopeSummary dex={bot.dex} revision={revision} freshness={freshnessSummary} stale={freshnessCheck?.ok === false} />
            <DefinitionList rows={[
              ['Bot', bot.name], ['Strategy revision', `v${revision.version}`], ['Approval', revision.status === 'approved' ? 'Approved revision' : 'Not approved'],
            ]} />
          </ReviewSection>
          <ReviewSection eyebrow="3 · RISK LIMITS" title="Shared portfolio boundaries">
            <p className="live-section-note">These limits are shared across every market evaluated by this deployment.</p>
            <DefinitionList rows={[
              ['Max order', usd(riskLimits.maxOrderUsd)], ['Max position', usd(riskLimits.maxPositionUsd)],
              ['Max total exposure', usd(riskLimits.maxTotalExposureUsd)],
              ['Max leverage', `${riskLimits.maxLeverage}×`], ['Max daily loss', usd(riskLimits.maxDailyLossUsd)],
              ['Max drawdown', `${riskLimits.maxDrawdownPercent}%`], ['Allowed sides', riskLimits.allowedSides.join(', ')],
              ['Order rate', `${riskLimits.maxOrdersPerMinute}/minute`],
            ]} />
          </ReviewSection>
        </div>
        <aside className="live-review-side">
          <LayerCard className="preflight-card">
            <div className="preflight-card-heading">
              <div><p className="eyebrow">4 · PREFLIGHT</p><h2>Safety checks</h2></div>
              {preparing ? <Badge variant="info">Checking</Badge> : preflight?.ready ? <Badge variant="success">Ready</Badge> : <Badge variant="error">Blocked</Badge>}
            </div>
            {preparing ? <p className="preflight-loading" role="status">Checking local runtime and testnet connection…</p> : (
              <ul className="preflight-checks">
                {preflight?.checks.map((check) => <li key={check.id} className={check.ok ? 'passed' : 'failed'}>
                  {check.ok ? <CheckCircleIcon aria-hidden="true" weight="fill" /> : <XCircleIcon aria-hidden="true" weight="fill" />}
                  <div><strong>{check.label}</strong><span>{check.message}</span>
                    {!check.ok && check.repairTarget === 'settings'
                      ? <a href="#settings" onClick={(event) => { event.preventDefault(); onOpenSettings?.(); }}>Open settings</a>
                      : null}
                  </div>
                </li>)}
              </ul>
            )}
          </LayerCard>
          <LayerCard className="live-confirm-card">
            <p className="eyebrow">5 · CONFIRMATION</p>
            <h2>Type the bot name</h2>
            <p>This is case-sensitive. Enter <strong>{bot.name}</strong> to enable Live execution.</p>
            <Input id="live-confirmation" label="Type bot name to confirm" value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} autoComplete="off" disabled={starting || preflight?.ready !== true} />
            <div className="live-confirm-actions">
              <Button type="button" variant="secondary" onClick={onRunPaper}>Run Paper instead</Button>
              <Button type="button" variant="destructive" disabled={!canStart} loading={starting} onClick={() => void start()}>Start Live</Button>
            </div>
            {failedChecks.length > 0 ? <p className="live-blocked-note">Resolve all {failedChecks.length} failed check{failedChecks.length === 1 ? '' : 's'} before starting.</p> : null}
          </LayerCard>
        </aside>
      </div>
    </main>
  );
}

function ReviewSection({ eyebrow, title, children }: Readonly<{ eyebrow: string; title: string; children: React.ReactNode }>) {
  return <LayerCard className="live-review-section"><p className="eyebrow">{eyebrow}</p><h2>{title}</h2>{children}</LayerCard>;
}

function DefinitionList({ rows }: { rows: ReadonlyArray<readonly [string, string]> }) {
  return <dl className="live-definition-list">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function usd(value: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value));
}
