import { describe, expect, it } from 'vitest';

import { LocalConfigSchema } from './config';

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
});
