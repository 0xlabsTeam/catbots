/** Browser-safe entry point: excludes backtesting and host filesystem/crypto modules. */
export { runtimeNodePackages } from './node-packages';
export { createAllCategoryExample } from './all-category-example';

export { evaluatePackagedFlow } from './node-packages';
export { exampleContext } from './package-examples';
export type { FlowDocument, FlowRun, FlowEdge } from '@catbots/node-kit';
