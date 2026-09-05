export function DeploymentScopeSummary({ freshness, stale = false }: Readonly<{
  freshness: string;
  stale?: boolean;
}>) {
  return (
    <div className="deployment-market-scope" aria-label="Deployment market scope">
      <p>DEX: Hyperliquid</p>
      <p>Market access: All active perpetual markets</p>
      <p className={stale ? 'deployment-freshness-stale' : undefined}>{freshness}</p>
    </div>
  );
}
