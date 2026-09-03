import { useEffect, useState } from 'react';
import type { BootstrapState } from '@catbots/contracts';
import { FirstLaunchScreen } from './screens/FirstLaunchScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AppShell, type AppDestination } from './components/AppShell';
import { BotsHomeScreen } from './screens/BotsHomeScreen';

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [destination, setDestination] = useState<AppDestination>('bots');
  useEffect(() => {
    let active = true;
    void window.catbots.config.getBootstrapState().then((state) => { if (active) setBootstrap(state); }).catch(() => { if (active) setBootstrap({ state: 'repair', issues: [{ path: 'config', message: 'Configuration requires repair' }] }); });
    return () => { active = false; };
  }, []);
  if (bootstrap === null) return <main className="app-loading" aria-live="polite">Loading local workspace…</main>;
  if (bootstrap.state === 'first-launch') return <FirstLaunchScreen api={window.catbots.config} onSaved={(config) => setBootstrap({ state: 'ready', config })} />;
  if (bootstrap.state === 'repair') return <SettingsScreen api={window.catbots.config} repairIssues={bootstrap.issues} onSaved={(config) => setBootstrap({ state: 'ready', config })} />;
  return (
    <AppShell destination={destination} onNavigate={setDestination}>
      {destination === 'bots' ? <BotsHomeScreen api={window.catbots.bots} /> : null}
      {destination === 'settings' ? <SettingsScreen api={window.catbots.config} config={bootstrap.config} embedded onSaved={(config) => setBootstrap({ state: 'ready', config })} /> : null}
      {destination === 'data' ? <PlaceholderScreen title="Data" description="Installed indicators and local data products will appear here in a later milestone." /> : null}
      {destination === 'activity' ? <PlaceholderScreen title="Activity" description="Local alerts and execution traces will appear here in a later milestone." /> : null}
    </AppShell>
  );
}

function PlaceholderScreen({ title, description }: { title: string; description: string }) {
  return <section className="destination-placeholder" aria-labelledby={`${title.toLowerCase()}-title`}><p className="eyebrow">LOCAL WORKSPACE</p><h1 id={`${title.toLowerCase()}-title`}>{title}</h1><p>{description}</p></section>;
}
