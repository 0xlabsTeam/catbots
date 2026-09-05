import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createPackageExample, exampleContext } from '@catbots/strategy-runtime';
import { FlowJournal } from '../src/main/nodes/flow-journal';
import { NodePackageService } from '../src/main/nodes/package-service';
const dirs:string[]=[];afterEach(()=>dirs.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true})));
function directory(){const dir=mkdtempSync(join(tmpdir(),'catbots-flow-'));dirs.push(dir);return dir;}
it('atomically persists state and proposals, replays the same run after restart, rejects conflicting retries',()=>{
  const file=join(directory(),'journal.json');const doc=createPackageExample('dca');const context=exampleContext('deployment-1',0,100);
  const first=new FlowJournal(file).evaluate(doc,context);expect(first.orders).toHaveLength(1);
  const restored=new FlowJournal(file);expect(restored.evaluate(doc,context)).toEqual(first);
  expect(()=>restored.evaluate(doc,{...context,price:90})).toThrow('different input');
  const next=exampleContext('deployment-1',1,100);next.fills=[{id:'fill-1',clientOrderId:first.orders[0].clientOrderId,side:'buy',quantity:1,price:100,fee:0}];
  const second=restored.evaluate(doc,next);expect((second.state.strategy as any).lots[0].quantity).toBe(1);
  const before=readFileSync(file,'utf8');expect(()=>restored.evaluate(doc,{...next,runId:'earlier',at:0})).toThrow('backwards');expect(readFileSync(file,'utf8')).toBe(before);
  expect(()=>restored.evaluate(createPackageExample('grid'),{...next,runId:'changed'})).toThrow('another graph');
});
it.each(['dca','grid','smart_order'] as const)('runs %s package examples through the shared backend without exchange access',example=>{
  const service=new NodePackageService(join(directory(),'packages.json'));
  const result=service.command({action:'simulate',example});
  expect(result.runtimePackages).toHaveLength(9);expect(result.simulation?.steps).toHaveLength(6);
  expect(result.simulation?.steps[0].proposed).toBeGreaterThan(0);
  expect(result.simulation?.steps[0].outputs.rsi).toMatchObject({value:{type:'number',quality:'ready',value:0}});
});
