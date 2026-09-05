import { z } from 'zod';

export const BotStatusSchema = z.enum([
  'draft', 'paper', 'live', 'paused', 'stopped', 'error', 'recovering',
]);

export type BotStatus = z.infer<typeof BotStatusSchema>;

export const DexIdSchema = z.enum(['hyperliquid']);

export type DexId = z.infer<typeof DexIdSchema>;

const CreateDraftBotInputSchemaBase = z.object({
  name: z.string().trim().min(1).max(80),
  dex: DexIdSchema,
}).strict();

/** Temporary static compatibility for callers pending their storage migration. */
export type CreateDraftBotInput = Omit<z.infer<typeof CreateDraftBotInputSchemaBase>, 'dex'> & {
  dex?: DexId;
  market: string;
};

export const CreateDraftBotInputSchema = CreateDraftBotInputSchemaBase as unknown as z.ZodType<CreateDraftBotInput>;

const BotSummarySchemaBase = CreateDraftBotInputSchemaBase.extend({
  id: z.string().uuid(),
  status: BotStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/**
 * Temporary compile-time compatibility for callers that still use the private
 * legacy market hint. The public schema intentionally strips that field.
 */
export type BotSummary = Omit<z.infer<typeof BotSummarySchemaBase>, 'dex'> & {
  dex?: DexId;
  market: string;
};

export const BotSummarySchema = BotSummarySchemaBase as unknown as z.ZodType<BotSummary>;
