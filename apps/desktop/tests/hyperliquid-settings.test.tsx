// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatbotsDesktopApi, RedactedLocalConfig } from '@catbots/contracts';

import { SettingsScreen } from '../src/renderer/screens/SettingsScreen';

const config: RedactedLocalConfig = {
  profile: { name: 'My Trading', telemetry: false },
  llm: { provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', apiKey: '••••••••', model: 'provider/model' },
  exchanges: {},
};

afterEach(cleanup);

describe('Hyperliquid Settings', () => {
  it('writes testnet settings through the form without rendering the Agent key again', async () => {
    const saved: RedactedLocalConfig = {
      ...config,
      exchanges: { hyperliquid: { network: 'testnet', accountAddress: '0x0123456789abcdef0123456789abcdef01234567', agentPrivateKey: '••••••••' } },
    };
    const api: CatbotsDesktopApi['config'] = {
      getBootstrapState: vi.fn(), patchSettings: vi.fn().mockResolvedValue(saved),
      testLlmConnection: vi.fn().mockResolvedValue({ ok: true, model: 'provider/model' }),
    };
    const user = userEvent.setup();
    render(<SettingsScreen api={api} config={config} />);

    await user.type(screen.getByLabelText('API key'), 'replacement-secret');
    await user.click(screen.getByRole('switch', { name: /Enable Hyperliquid testnet/ }));
    await user.type(screen.getByLabelText('Master account address'), '0x0123456789abcdef0123456789abcdef01234567');
    await user.type(screen.getByLabelText('Agent/API Wallet private key'), `0x${'a'.repeat(64)}`);
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(api.patchSettings).toHaveBeenCalledWith(expect.objectContaining({
      exchanges: { hyperliquid: expect.objectContaining({ network: 'testnet', accountAddress: '0x0123456789abcdef0123456789abcdef01234567' }) },
    }));
    expect((screen.getByLabelText('Agent/API Wallet private key') as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toContain('a'.repeat(64));
  });
});
