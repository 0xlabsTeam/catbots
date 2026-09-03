import { describe, expect, it } from 'vitest';

import { LocalConfigSchema, LocalSettingsPatchSchema, REDACTED_SECRET } from './config';

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
