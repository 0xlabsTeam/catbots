// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProviderStatus } from '@catbots/contracts';
import { ProviderConnections } from '../src/renderer/components/ProviderConnections';
afterEach(cleanup);
it('shows readable provider and default login labels, and submits the selected method', async () => {
  const status: ProviderStatus = { selected: null, providers: [{ id: 'openai-codex', name: 'OpenAI Codex', connected: false, oauth: true, apiKey: false, models: [] }], login: {
    id: 'session', provider: 'openai-codex', state: 'waiting', message: 'Choose a method',
    prompt: { id: 'prompt', type: 'select', message: 'Login method', options: [{ id: 'browser', label: 'Browser login (default)' }, { id: 'device_code', label: 'Device code login' }] },
  } };
  const command = vi.fn().mockResolvedValue(status);
  render(<ProviderConnections api={{ command }} />);
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Login method' }).textContent).toContain('Browser login (default)'));
  expect(screen.getByRole('combobox', { name: 'Subscription provider' }).textContent).toContain('OpenAI Codex');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
  expect(command).toHaveBeenCalledWith({ action: 'reply', sessionId: 'session', promptId: 'prompt', value: 'browser' });
});
it('shows the active provider model when settings opens', async () => {
  const status: ProviderStatus = { selected: { provider: 'openai-codex', model: 'test-model' }, login: null, providers: [{ id: 'openai-codex', name: 'OpenAI Codex', connected: true, oauth: true, apiKey: false, models: [{ id: 'test-model', name: 'Connected model' }] }] };
  render(<ProviderConnections api={{ command: vi.fn().mockResolvedValue(status) }} />);
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Chat model' }).textContent).toContain('Connected model'));
});
