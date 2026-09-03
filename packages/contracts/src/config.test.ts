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

describe('LocalConfigSchema', () => {
  it('accepts a compatible LLM and local profile', () => {
    expect(LocalConfigSchema.parse(valid).profile.telemetry).toBe(false);
  });

  it('rejects a master wallet key anywhere under Hyperliquid config', () => {
    expect(() => LocalConfigSchema.parse({
      ...valid,
      exchanges: { hyperliquid: { masterPrivateKey: '0xdeadbeef' } },
    })).toThrow();
  });
});
