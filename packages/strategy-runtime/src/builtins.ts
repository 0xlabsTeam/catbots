import { NodeRegistry } from '@catbots/node-kit';
import { triggerDefinitions } from '@catbots/nodes-trigger';
import { conditionDefinitions } from '@catbots/nodes-condition';
import { actionDefinitions } from '@catbots/nodes-action';
export const builtinNodeDefinitions = [...triggerDefinitions, ...conditionDefinitions, ...actionDefinitions];
export function createBuiltinRegistry(): NodeRegistry { return new NodeRegistry(builtinNodeDefinitions); }
