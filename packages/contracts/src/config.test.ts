import { describe, expect, it } from 'vitest';

import {
  CompatibleProviderUrlSchema,
  hasSameLlmCredentialScope,
  LocalConfigSchema,
  LocalSettingsPatchSchema,
  normalizeLlmProviderBaseUrl,
  REDACTED_SECRET,
} from './config';

const valid = {
  profile: { name: 'My Trading', telemetry: false },
  llm: {
    provider: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'secret',
    model: 'provider/model',
  },
};

const validHyperliquid = {
  network: 'testnet',
  accountAddress: '0x1111111111111111111111111111111111111111',
  agentPrivateKey: 'agent-secret',
};

describe('LocalConfigSchema', () => {
  it('accepts an explicit OpenAI-compatible reasoning effort and rejects it for Anthropic-compatible providers', () => {
    expect(LocalConfigSchema.parse({
      ...valid,
      llm: { ...valid.llm, reasoningEffort: 'none' },
    }).llm).toMatchObject({ reasoningEffort: 'none' });

    expect(LocalConfigSchema.safeParse({
      ...valid,
      llm: { ...valid.llm, provider: 'anthropic-compatible', reasoningEffort: 'none' },
    }).success).toBe(false);
  });

  it('accepts a compatible LLM and local profile', () => {
    expect(LocalConfigSchema.parse(valid).profile.telemetry).toBe(false);
  });

  it('accepts loopback HTTP for an IPv6-compatible local provider', () => {
    expect(LocalConfigSchema.parse({
      ...valid,
      llm: { ...valid.llm, baseUrl: 'http://[::1]:11434/v1' },
    }).llm.baseUrl).toBe('http://[::1]:11434/v1');
  });

  it('rejects a master wallet key anywhere under Hyperliquid config', () => {
    const result = LocalConfigSchema.safeParse({
      ...valid,
      exchanges: {
        hyperliquid: { ...validHyperliquid, masterPrivateKey: '0xdeadbeef' },
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({
          code: 'unrecognized_keys',
          keys: ['masterPrivateKey'],
          path: ['exchanges', 'hyperliquid'],
        }),
      ]);
    }
  });

  it('keeps Hyperliquid mainnet disabled in local configuration', () => {
    expect(LocalConfigSchema.safeParse({
      ...valid,
      exchanges: { hyperliquid: { ...validHyperliquid, network: 'mainnet' } },
    }).success).toBe(false);
  });

  it('accepts a typed settings patch that omits the already-stored API key', () => {
    expect(LocalSettingsPatchSchema.parse({
      profile: { name: 'Renamed profile', telemetry: true },
      llm: {
        provider: 'anthropic-compatible',
        baseUrl: 'https://provider.example/v1',
        model: 'new-model',
      },
    })).toEqual({
      profile: { name: 'Renamed profile', telemetry: true },
      llm: {
        provider: 'anthropic-compatible',
        baseUrl: 'https://provider.example/v1',
        model: 'new-model',
      },
    });
  });

  it('never accepts the renderer redaction mask as a stored secret', () => {
    expect(LocalSettingsPatchSchema.safeParse({
      profile: valid.profile,
      llm: { ...valid.llm, apiKey: REDACTED_SECRET },
    }).success).toBe(false);
    expect(LocalConfigSchema.safeParse({
      ...valid,
      llm: { ...valid.llm, apiKey: REDACTED_SECRET },
    }).success).toBe(false);
  });
});

describe('LLM credential scope', () => {
  it('returns a validation result instead of throwing for an incomplete URL', () => {
    expect(() => CompatibleProviderUrlSchema.safeParse('')).not.toThrow();
    expect(CompatibleProviderUrlSchema.safeParse('').success).toBe(false);
  });

  it('canonicalizes scheme, host, default port, and one missing trailing path slash', () => {
    expect(normalizeLlmProviderBaseUrl('HTTPS://API.EXAMPLE.COM:443/v1')).toBe('https://api.example.com/v1/');
    expect(normalizeLlmProviderBaseUrl('http://LOCALHOST:80')).toBe('http://localhost/');
  });

  it('treats only the same provider and canonical base path as the same credential scope', () => {
    const stored = { provider: 'openai-compatible' as const, baseUrl: 'HTTPS://API.EXAMPLE.COM:443/v1' };

    expect(hasSameLlmCredentialScope(stored, {
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1/',
    })).toBe(true);
    expect(hasSameLlmCredentialScope(stored, {
      provider: 'anthropic-compatible',
      baseUrl: 'https://api.example.com/v1/',
    })).toBe(false);
    expect(hasSameLlmCredentialScope(stored, {
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1/tenant',
    })).toBe(false);
  });
});
