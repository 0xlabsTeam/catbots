import { z } from 'zod';

export const REDACTED_SECRET = '••••••••' as const;

const StoredSecretSchema = z.string().min(1).refine(
  (value) => value !== REDACTED_SECRET,
  { message: 'A redacted value is not a credential' },
);

const LocalProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  telemetry: z.boolean().default(false),
}).strict();

export const CompatibleProviderUrlSchema = z.string().url().superRefine((value, ctx) => {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(hostname);

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    ctx.addIssue({ code: 'custom', message: 'Use HTTPS or loopback HTTP' });
  }
});

export const LlmProviderSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('openai-compatible'),
    baseUrl: CompatibleProviderUrlSchema,
    apiKey: StoredSecretSchema,
    model: z.string().min(1),
  }).strict(),
  z.object({
    provider: z.literal('anthropic-compatible'),
    baseUrl: CompatibleProviderUrlSchema,
    apiKey: StoredSecretSchema,
    model: z.string().min(1),
  }).strict(),
]);

export const LocalConfigSchema = z.object({
  profile: LocalProfileSchema,
  llm: LlmProviderSchema,
  exchanges: z.object({
    hyperliquid: z.object({
      network: z.enum(['testnet', 'mainnet']),
      accountAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      agentPrivateKey: StoredSecretSchema,
    }).strict().optional(),
  }).strict().default({}),
}).strict();

const LlmSettingsPatchSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('openai-compatible'),
    baseUrl: CompatibleProviderUrlSchema,
    apiKey: StoredSecretSchema.optional(),
    model: z.string().min(1),
  }).strict(),
  z.object({
    provider: z.literal('anthropic-compatible'),
    baseUrl: CompatibleProviderUrlSchema,
    apiKey: StoredSecretSchema.optional(),
    model: z.string().min(1),
  }).strict(),
]);

export const LocalSettingsPatchSchema = z.object({
  profile: LocalProfileSchema,
  llm: LlmSettingsPatchSchema,
}).strict();

export type LocalSettingsPatch = z.infer<typeof LocalSettingsPatchSchema>;

export type LocalConfig = z.infer<typeof LocalConfigSchema>;

export type RedactedLocalConfig = Omit<LocalConfig, 'llm' | 'exchanges'> & {
  llm: Omit<LocalConfig['llm'], 'apiKey'> & { apiKey: typeof REDACTED_SECRET };
  exchanges: {
    hyperliquid?: Omit<NonNullable<LocalConfig['exchanges']['hyperliquid']>, 'agentPrivateKey'> & {
      agentPrivateKey: typeof REDACTED_SECRET;
    };
  };
};
