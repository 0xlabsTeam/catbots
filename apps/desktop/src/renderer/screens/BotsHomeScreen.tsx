import { useCallback, useEffect, useRef, useState } from 'react';
import { Banner, Button, Table } from '@cloudflare/kumo';
import { PlusIcon, RobotIcon } from '@phosphor-icons/react';
import type { BotSummary, CatbotsDesktopApi } from '@catbots/contracts';
import { StatusBadge } from '../components/StatusBadge';
import { CreateDraftBotDialog } from './CreateDraftBotDialog';

type BotsHomeScreenProps = { api: CatbotsDesktopApi['bots'] };

export function formatUpdatedAt(value: string, locale = 'en-US', timeZone = 'UTC'): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return 'Updated locally';
  return `Updated ${new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: 'short' }).format(timestamp)}`;
}

function mergeBots(listedBots: readonly BotSummary[], locallyCreatedBots: ReadonlyMap<string, BotSummary>): BotSummary[] {
  const merged = new Map(listedBots.map((bot) => [bot.id, bot]));
  for (const [id, bot] of locallyCreatedBots) merged.set(id, bot);
  return [...merged.values()];
}

export function BotsHomeScreen({ api }: BotsHomeScreenProps) {
  const [bots, setBots] = useState<BotSummary[] | null>(null);
  const [hasListError, setHasListError] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const mountedRef = useRef(true);
  const listRequestTokenRef = useRef(0);
  const locallyCreatedBotsRef = useRef(new Map<string, BotSummary>());

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadBots = useCallback(async () => {
    const requestToken = listRequestTokenRef.current + 1;
    listRequestTokenRef.current = requestToken;
    setBots(null);
    setHasListError(false);
    try {
      const localBots = await api.list();
      if (!mountedRef.current || requestToken !== listRequestTokenRef.current) return;
      setBots(mergeBots(localBots, locallyCreatedBotsRef.current));
    } catch {
      if (!mountedRef.current || requestToken !== listRequestTokenRef.current) return;
      setBots([...locallyCreatedBotsRef.current.values()]);
      setHasListError(true);
    }
  }, [api]);

  useEffect(() => { void loadBots(); }, [loadBots]);

  const addCreatedBot = (created: BotSummary) => {
    locallyCreatedBotsRef.current.set(created.id, created);
    setHasListError(false);
    setBots((previous) => previous === null ? [...locallyCreatedBotsRef.current.values()] : mergeBots(previous, locallyCreatedBotsRef.current));
  };

  return (
    <section className="bots-home" aria-labelledby="bots-home-title">
      <header className="bots-home-header">
        <div>
          <p className="eyebrow">LOCAL BOTS</p>
          <h1 id="bots-home-title">Bots</h1>
          <p>Draft and inspect your local bot workspaces. No trading activity is available in M0.</p>
        </div>
        <Button type="button" variant="primary" icon={PlusIcon} onClick={() => setIsCreateOpen(true)}>Create new bot</Button>
      </header>

      {bots === null ? <div className="bots-state" role="status" aria-live="polite">Loading local bots…</div> : null}
      {hasListError ? (
        <div className="bots-list-error" role="alert">
          <Banner variant="error" title="Local bots unavailable" description="We could not load local bots. Try again." />
          <Button type="button" variant="secondary" onClick={() => { void loadBots(); }}>Try again</Button>
        </div>
      ) : null}
      {bots !== null && !hasListError && bots.length === 0 ? <EmptyBots onCreate={() => setIsCreateOpen(true)} /> : null}
      {bots !== null && bots.length > 0 ? <BotsTable bots={bots} /> : null}

      <CreateDraftBotDialog api={api} open={isCreateOpen} onOpenChange={setIsCreateOpen} onCreated={addCreatedBot} />
    </section>
  );
}

function EmptyBots({ onCreate }: { onCreate(): void }) {
  return (
    <div className="bots-empty-state">
      <span className="bots-empty-icon" aria-hidden="true"><RobotIcon weight="duotone" /></span>
      <div>
        <h2>No bots yet</h2>
        <p>Create a local draft with a name and market. You can shape its strategy in a later milestone.</p>
        <Button type="button" variant="secondary" icon={PlusIcon} onClick={onCreate}>Create new bot</Button>
      </div>
    </div>
  );
}

function BotsTable({ bots }: { bots: readonly BotSummary[] }) {
  return (
    <div className="bots-table-wrap">
      <Table aria-label="Local bots">
        <Table.Header>
          <Table.Row>
            <Table.Head>Name</Table.Head>
            <Table.Head>Market</Table.Head>
            <Table.Head>Status</Table.Head>
            <Table.Head>Updated</Table.Head>
            <Table.Head className="metric-heading">PnL</Table.Head>
            <Table.Head className="metric-heading">Drawdown</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {bots.map((bot) => (
            <Table.Row key={bot.id}>
              <Table.Cell><strong>{bot.name}</strong></Table.Cell>
              <Table.Cell>{bot.market}</Table.Cell>
              <Table.Cell><StatusBadge status={bot.status} /></Table.Cell>
              <Table.Cell><time dateTime={bot.updatedAt}>{formatUpdatedAt(bot.updatedAt)}</time></Table.Cell>
              <Table.Cell className="unavailable-metric" aria-label="PnL unavailable">PnL unavailable</Table.Cell>
              <Table.Cell className="unavailable-metric" aria-label="Drawdown unavailable">Drawdown unavailable</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </div>
  );
}
