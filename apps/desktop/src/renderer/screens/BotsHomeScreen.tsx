import { useCallback, useEffect, useRef, useState } from 'react';
import { Banner, Button, Empty, LayerCard, Table, Input, Select } from '@cloudflare/kumo';
import { PlusIcon, MagnifyingGlassIcon, ChatCircleTextIcon, GraphIcon, FlaskIcon } from '@phosphor-icons/react';
import type { BotSummary, CatbotsDesktopApi } from '@catbots/contracts';
import { BrandLogo } from '../components/BrandLogo';
import { StatusBadge } from '../components/StatusBadge';
import { CreateDraftBotDialog } from './CreateDraftBotDialog';

type BotsHomeScreenProps = { api: CatbotsDesktopApi['bots']; onOpenBot?(bot: BotSummary): void };

const DEX_DISPLAY_NAMES: Record<BotSummary['dex'], string> = {
  hyperliquid: 'Hyperliquid',
};

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

export function BotsHomeScreen({ api, onOpenBot }: BotsHomeScreenProps) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
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
    onOpenBot?.(created);
  };

  const filteredBots = bots?.filter((bot) => bot.name.toLowerCase().includes(query.trim().toLowerCase()) && (status === 'all' || bot.status === status)) ?? [];

  return (
    <section className="bots-home page-container" aria-labelledby="bots-home-title">
      <header className="bots-home-header">
        <div>
          <h1 id="bots-home-title">Bots</h1>
          <p>Turn a trading idea into a strategy you can inspect and test.</p>
        </div>
        <Button size="base" type="button" variant="primary" icon={PlusIcon} onClick={() => setIsCreateOpen(true)}>Create new bot</Button>
      </header>

      {bots === null ? <div className="bots-state" role="status" aria-live="polite">Loading local bots…</div> : null}
      {hasListError ? (
        <div className="bots-list-error" role="alert">
          <Banner variant="error" title="Local bots unavailable" description="We could not load local bots. Try again." />
          <Button size="base" type="button" variant="secondary" onClick={() => { void loadBots(); }}>Try again</Button>
        </div>
      ) : null}
      {bots !== null && !hasListError && bots.length === 0 ? <EmptyBots onCreate={() => setIsCreateOpen(true)} /> : null}
      {bots !== null && bots.length > 0 ? <>
        <div className="bots-toolbar">
          <Input size="base" aria-label="Search bots" placeholder="Search bots…" value={query} onChange={(event) => setQuery(event.target.value)} />
          <Select<string> size="base" aria-label="Filter by status" value={status} onValueChange={(value) => setStatus(value ?? 'all')} items={{ all: 'All statuses', draft: 'Draft', paper: 'Paper', live: 'Live', paused: 'Paused', stopped: 'Stopped', error: 'Error', recovering: 'Recovering' }}>
            <Select.Option value="all">All statuses</Select.Option>{['draft', 'paper', 'live', 'paused', 'stopped', 'error', 'recovering'].map((value) => <Select.Option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</Select.Option>)}
          </Select>
          <span className="bots-result-count" role="status">{filteredBots.length} of {bots.length} bots</span>
        </div>
        {filteredBots.length ? <BotsTable bots={filteredBots} onOpenBot={onOpenBot} /> : <div className="bots-state"><h2>No matching bots</h2><p>Try another name or status.</p><Button size="base" variant="secondary" onClick={() => { setQuery(''); setStatus('all'); }}>Clear filters</Button></div>}
      </> : null}

      <CreateDraftBotDialog api={api} open={isCreateOpen} onOpenChange={setIsCreateOpen} onCreated={addCreatedBot} />
    </section>
  );
}

function EmptyBots({ onCreate }: { onCreate(): void }) {
  return (
    <div className="bots-welcome"><Empty
      className="bots-empty-state"
      icon={<BrandLogo size="large" decorative />}
      title="No bots yet"
      description="Start with an idea. Build your strategy with AI, review the logic, and test it before deployment."
      contents={<Button size="base" type="button" variant="secondary" icon={PlusIcon} onClick={onCreate}>Create new bot</Button>}
    />
    <div className="getting-started" aria-label="How it works">
      <div><ChatCircleTextIcon size={22} aria-hidden="true" /><h3>Describe your strategy</h3><p>Give your bot a name, then explain your trading idea in chat.</p></div>
      <div><GraphIcon size={22} aria-hidden="true" /><h3>Review the logic</h3><p>Inspect triggers, conditions, and actions in a visual graph.</p></div>
      <div><FlaskIcon size={22} aria-hidden="true" /><h3>Test before deploying</h3><p>Run a backtest and review the results before moving to paper trading.</p></div>
    </div><p className="bots-market-note">Hyperliquid · Perpetual markets</p></div>
  );
}

function BotsTable({ bots, onOpenBot }: { bots: readonly BotSummary[]; onOpenBot?(bot: BotSummary): void }) {
  return (
    <LayerCard className="bots-table-wrap">
      <Table aria-label="Local bots">
        <Table.Header>
          <Table.Row>
            <Table.Head>Name</Table.Head>
            <Table.Head>DEX</Table.Head>
            <Table.Head>Status</Table.Head>
            <Table.Head>Updated</Table.Head>
            <Table.Head className="metric-heading">PnL</Table.Head>
            <Table.Head className="metric-heading">Drawdown</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {bots.map((bot) => (
            <Table.Row key={bot.id}>
              <Table.Cell><Button size="base" type="button" variant="ghost" className="bot-name-button" onClick={() => onOpenBot?.(bot)}>{bot.name}</Button></Table.Cell>
              <Table.Cell>{DEX_DISPLAY_NAMES[bot.dex]}</Table.Cell>
              <Table.Cell><StatusBadge status={bot.status} /></Table.Cell>
              <Table.Cell><time dateTime={bot.updatedAt}>{formatUpdatedAt(bot.updatedAt)}</time></Table.Cell>
              <Table.Cell className="unavailable-metric" aria-label="PnL unavailable">PnL unavailable</Table.Cell>
              <Table.Cell className="unavailable-metric" aria-label="Drawdown unavailable">Drawdown unavailable</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </LayerCard>
  );
}
