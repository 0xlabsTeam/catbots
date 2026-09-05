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
    patchSettings: vi.fn().mockResolvedValue(redactedConfig),
    testLlmConnection: vi.fn().mockResolvedValue({ ok: true, model: 'provider/model' }),
  };
}

describe('FirstLaunchScreen', () => {
  afterEach(cleanup);

  it('validates required provider fields before attempting the one-step setup', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<FirstLaunchScreen api={api} />);

    await user.click(screen.getByRole('button', { name: 'Connect & continue' }));

    expect(await screen.findByText('Enter a local profile name.')).toBeTruthy();
    expect(screen.getByText('Enter the provider URL.')).toBeTruthy();
    expect(screen.getByText('Enter the API key to test and save this provider.')).toBeTruthy();
    expect(screen.getByText('Enter a model identifier.')).toBeTruthy();
    expect(api.testLlmConnection).not.toHaveBeenCalled();
    expect(api.patchSettings).not.toHaveBeenCalled();
  });

  it('clears the API key input after the local profile is saved', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<FirstLaunchScreen api={api} />);

    await user.type(screen.getByLabelText('Profile name'), 'My Trading');
    await user.type(screen.getByLabelText('Base URL'), 'https://api.example.com/v1');
    await user.type(screen.getByLabelText('API key'), 'secret');
    await user.type(screen.getByLabelText('Model'), 'provider/model');
    await user.click(screen.getByRole('button', { name: 'Connect & continue' }));

    expect(await screen.findByText('Settings saved')).toBeTruthy();
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('');
    expect(api.patchSettings).toHaveBeenCalledWith(expect.objectContaining({
      llm: expect.objectContaining({ apiKey: 'secret' }),
    }));
  });

  it('uses the same one-step setup when the form is submitted with Enter', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    const onSaved = vi.fn();
    render(<FirstLaunchScreen api={api} onSaved={onSaved} />);

    await user.type(screen.getByLabelText('Profile name'), 'My Trading');
    await user.type(screen.getByLabelText('Base URL'), 'https://api.example.com/v1');
    await user.type(screen.getByLabelText('API key'), 'secret');
    await user.type(screen.getByLabelText('Model'), 'provider/model{Enter}');

    expect(await screen.findByText('Settings saved')).toBeTruthy();
    expect(onSaved).toHaveBeenCalledWith(redactedConfig);
  });

  it('uses the standard v1 path when an OpenAI-compatible root URL is entered', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<FirstLaunchScreen api={api} />);

    await user.type(screen.getByLabelText('Profile name'), 'My Trading');
    await user.type(screen.getByLabelText('Base URL'), 'http://localhost:1234');
    await user.type(screen.getByLabelText('API key'), 'secret');
    await user.type(screen.getByLabelText('Model'), 'provider/model');
    await user.click(screen.getByRole('button', { name: 'Connect & continue' }));

    expect(api.testLlmConnection).toHaveBeenCalledWith(expect.objectContaining({
      llm: expect.objectContaining({ baseUrl: 'http://localhost:1234/v1' }),
    }));
    expect(api.patchSettings).toHaveBeenCalledWith(expect.objectContaining({
      llm: expect.objectContaining({ baseUrl: 'http://localhost:1234/v1' }),
    }));
  });
});
