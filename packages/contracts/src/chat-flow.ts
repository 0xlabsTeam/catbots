import { z } from 'zod';
const id = z.string().min(1).max(120);
export const ChatFlowNodeSchema = z.object({ id, type: id, version: z.number().int().positive(), config: z.record(z.string(), z.unknown()) }).strict();
export const ChatFlowEdgeSchema = z.object({ source: id, sourcePort: id, target: id, targetPort: id }).strict();
export const ChatFlowDocumentSchema = z.object({ schemaVersion: z.literal('3.0'), nodes: z.array(ChatFlowNodeSchema).max(200), edges: z.array(ChatFlowEdgeSchema).max(1000) }).strict();
export const ChatFlowDraftSchema = z.object({ botId: z.string().uuid(), version: z.number().int().positive(), status: z.enum(['building', 'valid']), document: ChatFlowDocumentSchema, updatedAt: z.string().datetime() }).strict();
export type ChatFlowDraft = z.infer<typeof ChatFlowDraftSchema>;
export const ChatFlowEditSchema = z.object({ baseVersion: z.number().int().nonnegative(), operation: z.discriminatedUnion('type', [
  z.object({ type: z.literal('upsert_node'), node: ChatFlowNodeSchema }).strict(),
  z.object({ type: z.literal('remove_node'), nodeId: id }).strict(),
  z.object({ type: z.literal('connect'), edge: ChatFlowEdgeSchema }).strict(),
  z.object({ type: z.literal('disconnect'), edge: ChatFlowEdgeSchema }).strict(),
]) }).strict();
