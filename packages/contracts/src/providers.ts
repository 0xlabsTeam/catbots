import { z } from 'zod';
export const ProviderIdSchema = z.enum(['openai-codex', 'anthropic', 'github-copilot', 'xai', 'openrouter', 'radius']);
export const ProviderCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z.object({ action: z.literal('login'), provider: ProviderIdSchema, method: z.enum(['oauth', 'api_key']) }).strict(),
  z.object({ action: z.literal('reply'), sessionId: z.string().uuid(), promptId: z.string().uuid(), value: z.string().max(16000) }).strict(),
  z.object({ action: z.literal('open-login'), sessionId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('cancel'), sessionId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('logout'), provider: ProviderIdSchema }).strict(),
  z.object({ action: z.literal('select'), provider: ProviderIdSchema, model: z.string().min(1).max(250) }).strict(),
  z.object({ action: z.literal('compatible') }).strict(),
  z.object({ action: z.literal('refresh') }).strict(),
]);
export type ProviderCommand = z.infer<typeof ProviderCommandSchema>;
export type ProviderStatus = {
  providers: { id: string; name: string; connected: boolean; oauth: boolean; apiKey: boolean; models: { id: string; name: string }[] }[];
  selected: { provider: string; model: string } | null;
  login: { id: string; provider: string; state: 'waiting' | 'completed' | 'failed' | 'cancelled'; message?: string; url?: string; userCode?: string;
    prompt?: { id: string; type: 'text' | 'secret' | 'select' | 'manual_code'; message: string; options?: { id: string; label: string }[] } } | null;
};
