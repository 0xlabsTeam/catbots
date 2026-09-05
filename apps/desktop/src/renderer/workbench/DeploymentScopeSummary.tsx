import type { BotSummary, StrategyRevision } from '@catbots/contracts';

export function DeploymentScopeSummary({ dex, revision, freshness, stale = false }: Readonly<{
  dex: BotSummary['dex'];
  revision: StrategyRevision;
  freshness: string;
  stale?: boolean;
}>) {
  return (
    <div className="deployment-market-scope" aria-label="Deployment market scope">
      <p>DEX: {dex === 'hyperliquid' ? 'Hyperliquid' : dex}</p>
      <p>Market access: {marketAccessDescription(revision)}</p>
      <p className={stale ? 'deployment-freshness-stale' : undefined}>{freshness}</p>
    </div>
  );
}

type DynamicDeploymentRevision = Extract<StrategyRevision, { schemaVersion: '2.0' }> & { status: 'approved' };

export function isDynamicDeploymentEligible(
  revision: StrategyRevision | null | undefined,
): revision is DynamicDeploymentRevision {
  return revision?.status === 'approved'
    && revision.schemaVersion === '2.0'
    && revision.marketScope.type === 'dex_universe';
}

function marketAccessDescription(revision: StrategyRevision): string {
  if (revision.schemaVersion === '2.0' && revision.marketScope.type === 'dex_universe') {
    return 'All active perpetual markets';
  }
  return revision.marketScope.type === 'legacy_fixed' && revision.marketScope.market !== undefined
    ? `Fixed market · ${revision.marketScope.market}`
    : 'Fixed market · unavailable';
}
