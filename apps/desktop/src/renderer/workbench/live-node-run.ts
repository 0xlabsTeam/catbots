import type { CatbotsDesktopApi, MarketSnapshot } from '@catbots/contracts';
import { evaluatePackagedFlow, type FlowDocument } from '@catbots/strategy-runtime/node-examples';
export async function loadMarket(api: CatbotsDesktopApi['nodes'], market: string, timeframes: string[] = []) {
  if (!api) throw new Error('Market connection unavailable. Reload the application.');
  const result = await api.command({ action: 'market_snapshot', market, timeframes: timeframes as ('5m')[] });
  if (!result.marketSnapshot) throw new Error('Market data unavailable. No sample data was substituted.');
  return result.marketSnapshot;
}
export async function runLiveNode(document: FlowDocument, nodeId: string, api: CatbotsDesktopApi['nodes'], market: string) {
  const ids = new Set([nodeId]);
  for (let i=0;i<document.nodes.length;i++) for (const edge of document.edges) if (ids.has(edge.target)) ids.add(edge.source);
  const nodes = document.nodes.filter(node => ids.has(node.id));
  if (!nodes.some(node => node.id === nodeId)) throw new Error('Node not found');
  const snapshot = await loadMarket(api, market, [...new Set(nodes.filter(node => node.type === 'data.candles').map(node => String(node.config.timeframe)))]);
  const run = evaluatePackagedFlow({ ...document, nodes, edges: document.edges.filter(edge => ids.has(edge.target) && ids.has(edge.source)) }, {
    runId: crypto.randomUUID(), deploymentId: 'manual-market-run', market: snapshot.market, at: Date.parse(snapshot.fetchedAt),
    price: snapshot.price, candles: snapshot.candles, equity: NaN, fills: [], cancelledOrderIds: [],
  });
  return { run, snapshot };
}
export function marketCaption(snapshot: MarketSnapshot) { return `${snapshot.source} · ${snapshot.market} · fetched ${snapshot.fetchedAt} · mark price ${snapshot.price}`; }
