import { z } from 'zod';

export const CompatibleProviderUrlSchema = z.string().url().superRefine((value, ctx) => {
  const url = new URL(value);
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    ctx.addIssue({ code: 'custom', message: 'Use HTTPS or loopback HTTP' });
  }
});

export const LlmProviderSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('openai-compatible'),
    baseUrl: CompatibleProviderUrlSchema,
    apiKey: z.string().min(1),
    model: z.string().min(1),
  }).strict(),
  z.object({
    provider: z.literal('anthropic-compatible'),
    baseUrl: CompatibleProviderUrlSchema,
    apiKey: z.string().min(1),
    model: z.string().min(1),
  }).strict(),
]);

export const LocalConfigSchema = z.object({
  profile: z.object({
    name: z.string().trim().min(1).max(80),
    telemetry: z.boolean().default(false),
  }).strict(),
  llm: LlmProviderSchema,
  exchanges: z.object({
    hyperliquid: z.object({
      network: z.enum(['testnet', 'mainnet']),
      accountAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      agentPrivateKey: z.string().min(1),
    }).strict().optional(),
  }).strict().default({}),
}).strict();

export type LocalConfig = z.infer<typeof LocalConfigSchema>;

export type RedactedLocalConfig = Omit<LocalConfig, 'llm' | 'exchanges'> & {
  llm: Omit<LocalConfig['llm'], 'apiKey'> & { apiKey: '••••••••' };
  exchanges: {
    hyperliquid?: Omit<NonNullable<LocalConfig['exchanges']['hyperliquid']>, 'agentPrivateKey'> & {
      agentPrivateKey: '••••••••';
    };
  };
};
