import { evaluatePackagedFlow, exampleContext, type FlowDocument } from '@catbots/strategy-runtime/node-examples';
/** Evaluate only the selected node's upstream dependency closure; never dispatch orders. */
export function debugNode(document: FlowDocument, nodeId: string) {
  if (!document.nodes.some(node => node.id === nodeId)) throw new Error('Select an existing node.');
  const ids = new Set([nodeId]);
  for (let i = 0; i < document.nodes.length; i++) for (const edge of document.edges) if (ids.has(edge.target)) ids.add(edge.source);
  const subset = { ...document, nodes: document.nodes.filter(node => ids.has(node.id)), edges: document.edges.filter(edge => ids.has(edge.target) && ids.has(edge.source)) };
  return evaluatePackagedFlow(subset, exampleContext('node-debug', 0, 100));
}
