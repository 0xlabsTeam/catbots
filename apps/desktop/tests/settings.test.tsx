// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CatbotsDesktopApi, RedactedLocalConfig } from '@catbots/contracts';
import { SettingsScreen } from '../src/renderer/screens/SettingsScreen';

const redactedConfig: RedactedLocalConfig = {
  profile: { name: 'My Trading', telemetry: false },
  llm: {
    provider: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: '••••••••',
    model: 'provider/model',
  },
  exchanges: {},
};

function makeApi(): CatbotsDesktopApi['config'] {
  return {
    getBootstrapState: vi.fn().mockResolvedValue({ state: 'ready', config: redactedConfig }),
    save: vi.fn().mockResolvedValue(redactedConfig),
    testLlmConnection: vi.fn().mockResolvedValue({ ok: true, model: 'provider/model' }),
  };
}

describe('SettingsScreen', () => {
  afterEach(cleanup);

  it('shows accessible settings fields and never submits the redacted key mask', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<SettingsScreen api={api} config={redactedConfig} />);

    expect((screen.getByLabelText('Profile name') as HTMLInputElement).value).toBe('My Trading');
    expect(screen.getByLabelText('Provider')).toBeTruthy();
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe('https://api.example.com/v1');
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Stored key: ••••••••')).toBeTruthy();

    await user.clear(screen.getByLabelText('Base URL'));
    await user.type(screen.getByLabelText('Base URL'), 'http://api.example.com/v1');
    await user.type(screen.getByLabelText('API key'), 'replacement-secret');
    await user.type(screen.getByLabelText('Model'), '{Enter}');

    expect(await screen.findByText('Use HTTPS, or HTTP only for a provider on this computer.')).toBeTruthy();
    expect(api.testLlmConnection).not.toHaveBeenCalled();
    expect(api.save).not.toHaveBeenCalled();
  });

  it('invalidates a passed connection test when provider values change and accepts keyboard submit through the same path', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<SettingsScreen api={api} config={redactedConfig} />);

    await user.type(screen.getByLabelText('API key'), 'replacement-secret');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connection successful')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled).toBe(false);

    await user.type(screen.getByLabelText('Model'), '-new');
    expect((screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    await user.type(screen.getByLabelText('Model'), '{Enter}');

    expect(await screen.findByText('Settings saved')).toBeTruthy();
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({
      llm: expect.objectContaining({ apiKey: 'replacement-secret', model: 'provider/model-new' }),
    }));
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('');
  });

  it('renders only safe bootstrap repair paths', () => {
    const api = makeApi();
    render(<SettingsScreen
      api={api}
      repairIssues={[
        { path: 'llm.apiKey', message: 'Invalid configuration value' },
        { path: 'llm.api_key', message: 'secret should not render' },
        { path: 'profile.name', message: 'Invalid configuration value' },
      ]}
    />);

    expect(screen.getByText('Configuration repair')).toBeTruthy();
    expect(screen.getByText('llm.apiKey')).toBeTruthy();
    expect(screen.getByText('profile.name')).toBeTruthy();
    expect(screen.queryByText('llm.api_key')).toBeNull();
    expect(screen.queryByText('secret should not render')).toBeNull();
  });
});
