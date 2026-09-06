import { useState } from 'react';
import { Button } from '@cloudflare/kumo';
import type { CatbotsDesktopApi } from '@catbots/contracts';

type DatabaseRepairScreenProps = {
  onRetry?(): void;
  api: Pick<CatbotsDesktopApi['app'], 'quitApplication'>;
};

export function DatabaseRepairScreen({ api, onRetry }: DatabaseRepairScreenProps) {
  const [quitting, setQuitting] = useState(false);
  const [quitFailed, setQuitFailed] = useState(false);

  const quit = async () => {
    if (quitting) return;
    setQuitting(true);
    setQuitFailed(false);
    try {
      await api.quitApplication();
    } catch {
      setQuitFailed(true);
    } finally {
      setQuitting(false);
    }
  };

  return (
    <main className="app-loading">
      <section className="destination-placeholder" aria-labelledby="database-repair-title">
        <p className="eyebrow">LOCAL WORKSPACE</p>
        <h1 id="database-repair-title">Local database needs repair</h1>
        <p>Your local records were left unchanged.</p>
        <p>Quit Catbots and restore or repair the local database before opening the workspace again.</p>
        <ol><li>Quit Catbots before modifying any local files.</li><li>Make a copy of the entire Catbots profile, including its database and sidecar files.</li><li>Restore a known working backup of that profile, then reopen Catbots. Keep the original copy for diagnosis if no backup is available.</li></ol>
        {onRetry && <Button size="base" variant="secondary" onClick={onRetry}>Retry workspace</Button>}
        {quitFailed ? <p role="alert">Catbots could not open the Quit confirmation. Try again.</p> : null}
        <Button size="base" type="button" variant="primary" disabled={quitting} onClick={() => { void quit(); }}>
          {quitting ? 'Opening Quit confirmation…' : 'Quit Catbots'}
        </Button>
      </section>
    </main>
  );
}
