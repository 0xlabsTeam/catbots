import { useEffect, useState } from 'react';
import type { BootstrapState } from '@catbots/contracts';
import { FirstLaunchScreen } from './screens/FirstLaunchScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  useEffect(() => {
    let active = true;
    void window.catbots.config.getBootstrapState().then((state) => { if (active) setBootstrap(state); }).catch(() => { if (active) setBootstrap({ state: 'repair', issues: [{ path: 'config', message: 'Configuration requires repair' }] }); });
    return () => { active = false; };
  }, []);
  if (bootstrap === null) return <main className="app-loading" aria-live="polite">Loading local workspace…</main>;
  if (bootstrap.state === 'first-launch') return <FirstLaunchScreen api={window.catbots.config} onSaved={(config) => setBootstrap({ state: 'ready', config })} />;
  return <SettingsScreen api={window.catbots.config} config={bootstrap.state === 'ready' ? bootstrap.config : undefined} repairIssues={bootstrap.state === 'repair' ? bootstrap.issues : undefined} onSaved={(config) => setBootstrap({ state: 'ready', config })} />;
}
