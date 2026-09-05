import { useEffect, useState } from 'react';
import { Badge } from '@cloudflare/kumo';
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
};

export default function App({ api, preview = false }: AppProps) {
  const [databaseState, setDatabaseState] = useState<DatabaseState | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [destination, setDestination] = useState<AppDestination>('bots');
  const [selectedBot, setSelectedBot] = useState<BotSummary | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      let state: DatabaseState;
      try {
        state = await api.runtime.getDatabaseState();
      } catch {
        if (active) setDatabaseState({ status: 'repair', code: 'DATABASE_MIGRATION_FAILED' });
        return;
      }
      if (!active) return;
      setDatabaseState(state);
      if (state.status === 'repair') return;
      try {
        const nextBootstrap = await api.config.getBootstrapState();
        if (active) setBootstrap(nextBootstrap);
      } catch {
        if (active) setBootstrap({ state: 'repair', issues: [{ path: 'config', message: 'Configuration requires repair' }] });
      }
    })();
    return () => { active = false; };
  }, [api]);

  let screen;
  if (databaseState === null) screen = <main className="app-loading" aria-live="polite">Loading local workspace…</main>;
  else if (databaseState.status === 'repair') screen = <DatabaseRepairScreen api={api.app} />;
  else if (bootstrap === null) screen = <main className="app-loading" aria-live="polite">Loading local workspace…</main>;
  else if (bootstrap.state === 'first-launch') screen = <FirstLaunchScreen api={api.config} onSaved={(config) => setBootstrap({ state: 'ready', config })} />;
  else if (bootstrap.state === 'repair') screen = <SettingsScreen api={api.config} repairIssues={bootstrap.issues} onSaved={(config) => setBootstrap({ state: 'ready', config })} />;
  else screen = (
    <AppShell destination={destination} onNavigate={setDestination}>
      {destination === 'bots' && selectedBot === null ? <BotsHomeScreen api={api.bots} onOpenBot={setSelectedBot} /> : null}
      {destination === 'bots' && selectedBot !== null ? <BotWorkbenchScreen bot={selectedBot} api={api.workbench} deploymentApi={api.deployments} onBack={() => setSelectedBot(null)} onOpenSettings={() => setDestination('settings')} /> : null}
      {destination === 'settings' ? <SettingsScreen api={api.config} config={bootstrap.config} embedded onSaved={(config) => setBootstrap({ state: 'ready', config })} /> : null}
      {destination === 'data' ? <PlaceholderScreen title="Data" description="Installed indicators and local data products will appear here in a later milestone." /> : null}
      {destination === 'activity' ? <PlaceholderScreen title="Activity" description="Local alerts and execution traces will appear here in a later milestone." /> : null}
    </AppShell>
  );

  return <>{preview ? <aside className="web-preview-notice" role="status"><Badge variant="info">Web preview · simulated API · temporary data</Badge></aside> : null}{screen}</>;
}

function PlaceholderScreen({ title, description }: { title: string; description: string }) {
  return <section className="destination-placeholder" aria-labelledby={`${title.toLowerCase()}-title`}><p className="eyebrow">LOCAL WORKSPACE</p><h1 id={`${title.toLowerCase()}-title`}>{title}</h1><p>{description}</p></section>;
}
