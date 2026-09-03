// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotSummary, CatbotsDesktopApi, CreateDraftBotInput } from '@catbots/contracts';
import { AppShell } from '../src/renderer/components/AppShell';
import { BotsHomeScreen } from '../src/renderer/screens/BotsHomeScreen';

const draftBot: BotSummary = {
  id: '018f47a2-4a2a-7c5d-9b61-3a83f64406a8',
  name: 'BTC Flow',
  market: 'BTC-PERP',
  status: 'draft',
  createdAt: '2026-09-03T00:00:00.000Z',
  updatedAt: '2026-09-03T00:00:00.000Z',
};

function makeApi(overrides: Partial<CatbotsDesktopApi['bots']> = {}): CatbotsDesktopApi['bots'] {
  return {
    list: vi.fn().mockResolvedValue([]),
    createDraft: vi.fn().mockImplementation(async (input: CreateDraftBotInput) => ({ ...draftBot, ...input })),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe('BotsHomeScreen', () => {
  afterEach(cleanup);

  it('creates a local draft and shows it on Bots Home', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<BotsHomeScreen api={api} />);

    await user.click(await screen.findByRole('button', { name: 'Create new bot' }));
    await user.type(screen.getByLabelText('Bot name'), 'BTC Flow');
    await user.type(screen.getByLabelText('Market'), 'BTC-PERP');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(await screen.findByText('BTC Flow')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(api.createDraft).toHaveBeenCalledWith({ name: 'BTC Flow', market: 'BTC-PERP' });
    expect(screen.getByText('PnL unavailable')).toBeTruthy();
    expect(screen.getByText('Drawdown unavailable')).toBeTruthy();
  });

  it('renders an accessible loading state before the local list arrives', () => {
    const pending = deferred<BotSummary[]>();
    render(<BotsHomeScreen api={makeApi({ list: vi.fn().mockReturnValue(pending.promise) })} />);

    expect(screen.getByRole('status').textContent).toContain('Loading local bots…');
  });

  it('renders an accessible empty state and a fixed safe list failure', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<BotsHomeScreen api={makeApi()} />);
    expect(await screen.findByRole('heading', { name: 'No bots yet' })).toBeTruthy();

    rerender(<BotsHomeScreen api={makeApi({ list: vi.fn().mockRejectedValue(new Error('database /Users/secret/db.sqlite')) })} />);
    expect((await screen.findByRole('alert')).textContent).toContain('We could not load local bots. Try again.');
    expect(document.body.textContent).not.toContain('/Users/secret/db.sqlite');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
  });

  it('prevents duplicate draft requests, uses fixed failure copy, and keeps field values after failure', async () => {
    const user = userEvent.setup();
    const pending = deferred<BotSummary>();
    const createDraft = vi.fn().mockReturnValue(pending.promise);
    render(<BotsHomeScreen api={makeApi({ createDraft })} />);

    await user.click(await screen.findByRole('button', { name: 'Create new bot' }));
    await user.type(screen.getByLabelText('Bot name'), 'BTC Flow');
    await user.type(screen.getByLabelText('Market'), 'BTC-PERP');
    fireEvent.submit(screen.getByRole('button', { name: 'Create draft' }).closest('form')!);
    fireEvent.submit(screen.getByRole('button', { name: /Create draft/ }).closest('form')!);
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Bot name') as HTMLInputElement).disabled).toBe(true);

    await act(async () => pending.reject(new Error('hostile dependency detail')));
    expect(screen.getByRole('alert').textContent).toContain('We could not create this draft. Review the local values and try again.');
    expect((screen.getByLabelText('Bot name') as HTMLInputElement).value).toBe('BTC Flow');
    expect(document.body.textContent).not.toContain('hostile dependency detail');
  });

  it('ignores bot-list and draft results after unmount', async () => {
    const user = userEvent.setup();
    const list = deferred<BotSummary[]>();
    const createDraft = deferred<BotSummary>();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const firstView = render(<BotsHomeScreen api={makeApi({ list: vi.fn().mockReturnValue(list.promise) })} />);
    firstView.unmount();
    await act(async () => list.resolve([draftBot]));

    const secondView = render(<BotsHomeScreen api={makeApi({ createDraft: vi.fn().mockReturnValue(createDraft.promise) })} />);
    await user.click(await screen.findByRole('button', { name: 'Create new bot' }));
    await user.type(screen.getByLabelText('Bot name'), 'BTC Flow');
    await user.type(screen.getByLabelText('Market'), 'BTC-PERP');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    secondView.unmount();
    await act(async () => createDraft.resolve(draftBot));

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('AppShell', () => {
  afterEach(cleanup);

  it('exposes only the approved global navigation destinations with a non-color active indicator', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<AppShell destination="bots" onNavigate={onNavigate}><p>Workspace</p></AppShell>);

    expect(screen.getByRole('navigation', { name: 'Global navigation' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Global navigation' }).querySelectorAll('button').length).toBe(4);
    expect(screen.getByRole('button', { name: 'Bots' }).getAttribute('aria-current')).toBe('page');
    for (const destination of ['Bots', 'Data', 'Activity', 'Settings']) {
      expect(screen.getByRole('button', { name: destination })).toBeTruthy();
    }
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });
});
