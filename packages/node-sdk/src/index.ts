/** Declarative SDK v1. Community artifacts are JSON; no package code is loaded by Catbots. */
export { NodePackageSchema, CommunityNodeSchema, NodeFieldSchema, type NodePackage, type CommunityNode } from '@catbots/contracts';
export { validateNodePackage, communityConfigSchema, CommunityNodeCatalog } from '@catbots/strategy-runtime';
export { definePackage, ready, unavailable, type RuntimePackage, type FlowDefinition, type FlowDocument, type FlowContext, type Value, type OrderPlan } from '@catbots/node-kit';
