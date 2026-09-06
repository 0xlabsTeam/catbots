import { expect, it } from 'vitest';
import { createAllCategoryExample } from './all-category-example';
import { evaluatePackagedFlow, runtimeNodePackages } from './node-packages';
import { exampleContext } from './package-examples';

it('connects real definitions from all nine categories with valid typed ports', () => {
  const document = createAllCategoryExample();
  const definitions = new Map(runtimeNodePackages.flatMap(pkg => pkg.definitions.map(def => [def.type, def] as const)));
  expect(new Set(document.nodes.map(node => definitions.get(node.type)?.category)).size).toBe(9);
  const result = evaluatePackagedFlow(document, exampleContext('all-categories', 0, 100));
  expect(result.trace).toHaveLength(12);
  expect(result.trace.find(node => node.nodeId === 'size')?.outputs.quantity.value).toBe(1);
  // Independent strategy and action branches both emit proposals in this teaching example.
  expect(result.orders).toHaveLength(2);
  expect(result.trace.find(node => node.nodeId === 'debug')?.outputs.value.value).toBe(0);
});
