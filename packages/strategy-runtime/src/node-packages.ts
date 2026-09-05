import { triggerPackage } from '@catbots/nodes-trigger';
import { dataPackage } from '@catbots/nodes-data';
import { indicatorPackage } from '@catbots/nodes-indicator';
import { processPackage } from '@catbots/nodes-process';
import { conditionPackage } from '@catbots/nodes-condition';
import { strategyPackage } from '@catbots/nodes-strategy';
import { riskPackage } from '@catbots/nodes-risk';
import { actionPackage } from '@catbots/nodes-action';
import { outputPackage } from '@catbots/nodes-output';
import { evaluateFlow, type FlowContext, type FlowDocument, type FlowRun } from '@catbots/node-kit';
export const runtimeNodePackages = [triggerPackage,dataPackage,indicatorPackage,processPackage,conditionPackage,strategyPackage,riskPackage,actionPackage,outputPackage];
export function listRuntimePackages() { return runtimeNodePackages.map(pkg=>({name:pkg.name,version:pkg.version,mode:'simulation' as const,nodes:pkg.definitions.map(def=>({type:def.type,version:def.version,category:def.category,title:def.title,inputs:def.inputs,outputs:def.outputs}))})); }
export function evaluatePackagedFlow(document:FlowDocument,context:FlowContext,previous:Record<string,unknown>={}):FlowRun {return evaluateFlow(document,runtimeNodePackages,context,previous);}
export type { FlowDocument, FlowContext, FlowRun } from '@catbots/node-kit';
