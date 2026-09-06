/** JSON-only execution data. Configuration and execution provenance live outside json. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ItemLink = { nodeId: string; port: string; item: number };
export type ExecutionItem = { json: Record<string, Json>; pairedItem?: ItemLink[] };
export const MAX_ITEMS = 10000;
export function assertJson(value: unknown, depth = 0): asserts value is Json {
  if (depth > 32) throw new Error('JSON nesting limit exceeded');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || !value || !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Expected finite JSON data');
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe JSON field');
    assertJson(child, depth + 1);
  }
}
export function assertItems(value: unknown): asserts value is ExecutionItem[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new Error('Expected at most 10000 execution items');
  for (const item of value) {
    assertJson(item);
    if (!item || typeof item !== 'object' || Array.isArray(item) || !item.json || typeof item.json !== 'object' || Array.isArray(item.json)) throw new Error('Each item requires a json object');
    if (Object.keys(item).some(key => !['json', 'pairedItem'].includes(key))) throw new Error('Unknown item envelope field');
    if (item.pairedItem !== undefined && (!Array.isArray(item.pairedItem) || item.pairedItem.some((link: any) => !link || typeof link.nodeId !== 'string' || typeof link.port !== 'string' || !Number.isInteger(link.item) || link.item < 0))) throw new Error('Invalid item pairing');
  }
}
/** Deliberately no JavaScript expressions or prototype traversal. */
export function readItemField(json: Record<string, Json>, path: string): Json {
  let value: Json = json;
  for (const key of path.split('.')) {
    if (!key || ['__proto__', 'constructor', 'prototype'].includes(key) || value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error(`Missing or unsafe field: ${path}`);
    value = (value as Record<string, Json>)[key];
  }
  return value;
}
