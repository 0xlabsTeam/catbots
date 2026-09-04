import { useEffect, useState } from 'react';
import { Badge } from '@cloudflare/kumo';
import type { BootstrapState, CatbotsDesktopApi } from '@catbots/contracts';
import { FirstLaunchScreen } from './screens/FirstLaunchScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AppShell, type AppDestination } from './components/AppShell';
import { BotsHomeScreen } from './screens/BotsHomeScreen';

type AppProps = {
  api: CatbotsDesktopApi;
  preview?: boolean;
};

export default function App({ api, preview = false }: AppProps) {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [destination, setDestination] = useState<AppDestination>('bots');
  useEffect(() => {
    let active = true;
    void api.config.getBootstrapState().then((state) => { if (active) setBootstrap(state); }).catch(() => { if (active) setBootstrap({ state: 'repair', issues: [{ path: 'config', message: 'Configuration requires repair' }] }); });
    return () => { active = false; };
  }, [api]);

  let screen;
  if (bootstrap === null) screen = <main className="app-loading" aria-live="polite">Loading local workspace…</main>;
  else if (bootstrap.state === 'first-launch') screen = <FirstLaunchScreen api={api.config} onSaved={(config) => setBootstrap({ state: 'ready', config })} />;
  else if (bootstrap.state === 'repair') screen = <SettingsScreen api={api.config} repairIssues={bootstrap.issues} onSaved={(config) => setBootstrap({ state: 'ready', config })} />;
  else screen = (
    <AppShell destination={destination} onNavigate={setDestination}>
      {destination === 'bots' ? <BotsHomeScreen api={api.bots} /> : null}
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
