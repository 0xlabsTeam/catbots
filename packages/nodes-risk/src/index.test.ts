import { expect, it } from 'vitest';
import { riskPackage, trailingDefinition } from './index';
import { ready, type FlowContext } from '@catbots/node-kit';
const context={deploymentId:'deployment',market:'SOL',at:1} as FlowContext;
it('sizes from stop distance and caps notional',()=>{
  const node=riskPackage.definitions[0];
  expect(node.evaluate({equity:ready('number',1000),entry:ready('number',100),stop:ready('number',95)},{riskPercent:1,maxNotional:1000},context,undefined,'size').outputs.quantity.value).toBe(2);
  expect(node.evaluate({equity:ready('number',1000),entry:ready('number',100),stop:ready('number',95)},{riskPercent:1,maxNotional:100},context,undefined,'size').outputs.quantity.value).toBe(1);
});
it('persists trailing activation and does not move a long stop backwards',()=>{
  const config={side:'long',activationPercent:2,callbackPercent:1};
  const run=(price:number,state?:unknown)=>trailingDefinition.evaluate({entry:ready('number',100),price:ready('number',price)},config,context,state,'trailing');
  const a=run(101);expect(a.outputs.exit.value).toBe(false);expect(a.outputs.stop.quality).toBe('unavailable');
  const b=run(105,a.state);expect(b.outputs.stop.value).toBe(103.95);
  const c=run(104,b.state);expect(c.outputs.stop.value).toBe(103.95);expect(c.outputs.exit.value).toBe(false);
  const d=run(103,c.state);expect(d.outputs.exit.value).toBe(true);
});
