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

export const OpenAiReasoningEffortSchema = z.enum(['none', 'low', 'medium', 'high']);
export type OpenAiReasoningEffort = z.infer<typeof OpenAiReasoningEffortSchema>;

export const CompatibleProviderUrlSchema = z.string().url().superRefine((value, ctx) => {
  if (!URL.canParse(value)) return;
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
    reasoningEffort: OpenAiReasoningEffortSchema.optional(),
  }).strict(),
  z.object({
    provider: z.literal('anthropic-compatible'),
    baseUrl: CompatibleProviderUrlSchema,
    apiKey: StoredSecretSchema,
    model: z.string().min(1),
  }).strict(),
]);

export type LlmCredentialScope = Pick<z.infer<typeof LlmProviderSchema>, 'provider' | 'baseUrl'>;

/** Canonicalizes the effective provider base used to derive protocol request endpoints. */
export function normalizeLlmProviderBaseUrl(value: string): string {
  const normalized = new URL(CompatibleProviderUrlSchema.parse(value));
  normalized.search = '';
  normalized.hash = '';
  if (!normalized.pathname.endsWith('/')) normalized.pathname += '/';
  return normalized.toString();
}

export function hasSameLlmCredentialScope(
  left: LlmCredentialScope,
  right: LlmCredentialScope,
): boolean {
  return left.provider === right.provider
    && normalizeLlmProviderBaseUrl(left.baseUrl) === normalizeLlmProviderBaseUrl(right.baseUrl);
}

export const LocalConfigSchema = z.object({
  profile: LocalProfileSchema,
  llm: LlmProviderSchema,
  exchanges: z.object({
    hyperliquid: z.object({
      network: z.literal('testnet'),
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
    reasoningEffort: OpenAiReasoningEffortSchema.optional(),
  }).strict(),
  z.object({
    provider: z.literal('anthropic-compatible'),
    baseUrl: CompatibleProviderUrlSchema,
    apiKey: StoredSecretSchema.optional(),
    model: z.string().min(1),
  }).strict(),
]);

const HyperliquidSettingsPatchSchema = z.object({
  network: z.literal('testnet'),
  accountAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  agentPrivateKey: StoredSecretSchema.optional(),
}).strict();

export const LocalSettingsPatchSchema = z.object({
  profile: LocalProfileSchema,
  llm: LlmSettingsPatchSchema,
  exchanges: z.object({
    hyperliquid: HyperliquidSettingsPatchSchema.nullable(),
  }).strict().optional(),
}).strict();

export type LocalSettingsPatch = z.infer<typeof LocalSettingsPatchSchema>;

export type LocalConfig = z.infer<typeof LocalConfigSchema>;

type RedactedLlmProvider<Provider> = Provider extends { apiKey: string }
  ? Omit<Provider, 'apiKey'> & { apiKey: typeof REDACTED_SECRET }
  : never;

export type RedactedLocalConfig = Omit<LocalConfig, 'llm' | 'exchanges'> & {
  llm: RedactedLlmProvider<LocalConfig['llm']>;
  exchanges: {
    hyperliquid?: Omit<NonNullable<LocalConfig['exchanges']['hyperliquid']>, 'agentPrivateKey'> & {
      agentPrivateKey: typeof REDACTED_SECRET;
    };
  };
};
