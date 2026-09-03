// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CatbotsDesktopApi, RedactedLocalConfig } from '@catbots/contracts';
import { FirstLaunchScreen } from '../src/renderer/screens/FirstLaunchScreen';

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
    getBootstrapState: vi.fn().mockResolvedValue({ state: 'first-launch' }),
    save: vi.fn().mockResolvedValue(redactedConfig),
    testLlmConnection: vi.fn().mockResolvedValue({ ok: true, model: 'provider/model' }),
  };
}

describe('FirstLaunchScreen', () => {
  afterEach(cleanup);

  it('requires a successful provider test before completing setup', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<FirstLaunchScreen api={api} />);

    await user.type(screen.getByLabelText('Profile name'), 'My Trading');
    await user.type(screen.getByLabelText('Base URL'), 'https://api.example.com/v1');
    await user.type(screen.getByLabelText('API key'), 'secret');
    await user.type(screen.getByLabelText('Model'), 'provider/model');

    expect((screen.getByRole('button', { name: 'Create local profile' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connection successful')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create local profile' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('clears the API key input after the local profile is saved', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<FirstLaunchScreen api={api} />);

    await user.type(screen.getByLabelText('Profile name'), 'My Trading');
    await user.type(screen.getByLabelText('Base URL'), 'https://api.example.com/v1');
    await user.type(screen.getByLabelText('API key'), 'secret');
    await user.type(screen.getByLabelText('Model'), 'provider/model');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    await user.click(screen.getByRole('button', { name: 'Create local profile' }));

    expect(await screen.findByText('Settings saved')).toBeTruthy();
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('');
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({
      llm: expect.objectContaining({ apiKey: 'secret' }),
    }));
  });
});
