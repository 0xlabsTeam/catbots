import { describe, expect, it } from 'vitest';
import { BotSummarySchema, REDACTED_SECRET } from '@catbots/contracts';
import { createWebPreviewApi } from '../src/renderer/web-preview-api';

const settings = {
  profile: { name: 'Preview Trader', telemetry: false },
  llm: {
    provider: 'openai-compatible' as const,
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'preview-secret-that-must-not-be-retained',
    model: 'preview/model',
  },
};

describe('web preview API', () => {
  it('starts at first launch and keeps only redacted provider settings after save', async () => {
    const api = createWebPreviewApi();

    expect(await api.config.getBootstrapState()).toEqual({ state: 'first-launch' });

    const saved = await api.config.patchSettings(settings);
    const bootstrap = await api.config.getBootstrapState();

    expect(saved.llm.apiKey).toBe(REDACTED_SECRET);
    expect(bootstrap).toEqual({ state: 'ready', config: saved });
    expect(JSON.stringify(bootstrap)).not.toContain(settings.llm.apiKey);
  });

  it('simulates a provider connection without requiring a network service', async () => {
    const api = createWebPreviewApi();

    await expect(api.config.testLlmConnection(settings)).resolves.toEqual({
      ok: true,
      model: 'preview/model',
    });
  });

  it('creates valid drafts and returns them from the same preview session', async () => {
    const api = createWebPreviewApi();

    const draft = await api.bots.createDraft({ name: ' BTC Flow ', market: ' BTC-PERP ' });

    expect(BotSummarySchema.parse(draft)).toEqual(draft);
    expect(draft).toMatchObject({ name: 'BTC Flow', market: 'BTC-PERP' });
    expect(draft.status).toBe('draft');
    expect(await api.bots.list()).toEqual([draft]);
  });
});
