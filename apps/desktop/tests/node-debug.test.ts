import { expect, it } from 'vitest';
import { starterFlow } from '../src/renderer/workbench/flow-editor-model';
import { debugNode } from '../src/renderer/workbench/node-debug';
it('debugs only upstream dependencies and excludes order actions for indicator inspection', () => {
  const document = starterFlow();
  const indicator = document.nodes.find(node => node.type === 'indicator.rsi')!;
  const run = debugNode(document, indicator.id);
  expect(run.orders).toHaveLength(0);
  expect(run.trace.at(-1)?.nodeId).toBe(indicator.id);
  expect(run.trace.at(-1)?.outputs.value?.quality).toBe('ready');
  expect(run.trace.some(item => item.nodeId === 'order')).toBe(false);
});
it('reports missing inputs rather than making up a value', () => {
  const document = starterFlow();
  const indicator = document.nodes.find(node => node.type === 'indicator.rsi')!;
  document.edges = document.edges.filter(edge => edge.target !== indicator.id);
  expect(() => debugNode(document, indicator.id)).toThrow('Missing input');
});
