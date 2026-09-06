import { NodesScreen } from './screens/NodesScreen';
import { ProviderConnections } from './components/ProviderConnections';
import { useEffect, useState } from 'react';
import { Badge, Button } from '@cloudflare/kumo';
import type { BootstrapState, BotSummary, CatbotsDesktopApi, DatabaseState } from '@catbots/contracts';
import { FirstLaunchScreen } from './screens/FirstLaunchScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AppShell, type AppDestination } from './components/AppShell';
import { BotsHomeScreen } from './screens/BotsHomeScreen';
import { BotWorkbenchScreen } from './screens/BotWorkbenchScreen';
import { DatabaseRepairScreen } from './screens/DatabaseRepairScreen';

type AppProps = {
  api: CatbotsDesktopApi;
  preview?: boolean;
  surface?: 'desktop' | 'web';
};

export default function App({ api, preview = false, surface = 'desktop' }: AppProps) {
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const retryLoad = () => { setLoadError(false); setDatabaseState(null); setBootstrap(null); setRetry(value => value + 1); };
  const [databaseState, setDatabaseState] = useState<DatabaseState | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [subscriptionReady, setSubscriptionReady] = useState(false);
  const [destination, setDestination] = useState<AppDestination>('bots');
  const [selectedBot, setSelectedBot] = useState<BotSummary | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      let state: DatabaseState;
      try {
        state = await api.runtime.getDatabaseState();
      } catch {
        if (active) setLoadError(true);
        return;
      }
      if (!active) return;
      setDatabaseState(state);
      if (state.status === 'repair') return;
      try {
        const nextBootstrap = await api.config.getBootstrapState();
        if (active) setBootstrap(nextBootstrap);
        if (api.providers) { const providers = await api.providers.command({ action: 'status' }); if (active) setSubscriptionReady(!!providers.selected); }
      } catch {
        if (active) setLoadError(true);
      }
    })();
    return () => { active = false; };
  }, [api, retry]);

  let screen;
  if (loadError) screen = <main className="app-loading"><section><h1>Cannot reach local workspace</h1><p>Check that the Catbots local backend is running, then retry. Your saved data has not been changed.</p><Button size="base" onClick={retryLoad}>Retry connection</Button></section></main>;
  else if (databaseState === null) screen = <main className="app-loading" aria-live="polite">Loading local workspace…</main>;
  else if (databaseState.status === 'repair') screen = <DatabaseRepairScreen api={api.app} onRetry={retryLoad} />;
  else if (bootstrap === null) screen = <main className="app-loading" aria-live="polite">Loading local workspace…</main>;
  else if (bootstrap.state === 'first-launch' && !subscriptionReady) screen = <>{api.providers && <ProviderConnections api={api.providers} onSelected={() => setSubscriptionReady(true)} />}<FirstLaunchScreen api={api.config} onSaved={(config) => setBootstrap({ state: 'ready', config })} /></>;
  else if (bootstrap.state === 'repair') screen = <SettingsScreen api={api.config} repairIssues={bootstrap.issues} onSaved={(config) => setBootstrap({ state: 'ready', config })} />;
  else screen = (
    <AppShell focused={destination === 'bots' && selectedBot !== null} surface={surface} destination={destination} onNavigate={(next) => { setDestination(next); if (next === 'bots') setSelectedBot(null); }}>
      {destination === 'bots' && selectedBot === null ? <BotsHomeScreen api={api.bots} onOpenBot={setSelectedBot} /> : null}
      {destination === 'bots' && selectedBot !== null ? <BotWorkbenchScreen key={selectedBot.id} bot={selectedBot} api={api.workbench} nodeApi={api.nodes} deploymentApi={api.deployments} onBack={() => setSelectedBot(null)} onOpenSettings={() => setDestination('settings')} /> : null}
      {destination === 'settings' ? <SettingsScreen connections={api.providers && <ProviderConnections api={api.providers} onSelected={() => setSubscriptionReady(true)} />} api={api.config} config={'config' in bootstrap ? bootstrap.config : undefined} embedded onSaved={(config) => setBootstrap({ state: 'ready', config })} /> : null}
      {destination === 'nodes' && api.nodes ? <NodesScreen api={api.nodes} bots={api.bots} onOpenBot={bot => { setSelectedBot(bot); setDestination('bots'); }} /> : null}
      {destination === 'data' ? <PlaceholderScreen onOpenBots={() => { setSelectedBot(null); setDestination('bots'); }} title="Data" description="The data catalog is coming soon. To inspect current Hyperliquid prices and candles, open a bot, select a node and choose Run node." /> : null}
      {destination === 'activity' ? <PlaceholderScreen onOpenBots={() => { setSelectedBot(null); setDestination('bots'); }} title="Activity" description="Workspace-wide activity is coming soon. Saved execution logs are available inside each bot under Logs; manual node results are in Data & debug." /> : null}
    </AppShell>
  );

  return <>{preview ? <aside className="web-preview-notice" role="status"><Badge variant="info">Web preview · simulated API · simulated data</Badge></aside> : null}{screen}</>;
}

function PlaceholderScreen({ title, description, onOpenBots }: { title: string; description: string; onOpenBots(): void }) {
  return <section className="destination-placeholder page-container" aria-labelledby={`${title.toLowerCase()}-title`}><p className="eyebrow">LOCAL WORKSPACE</p><h1 id={`${title.toLowerCase()}-title`}>{title}</h1><Badge variant="secondary">Coming soon</Badge><p>{description}</p><Button size="base" variant="secondary" onClick={onOpenBots}>Open bots</Button></section>;
}
