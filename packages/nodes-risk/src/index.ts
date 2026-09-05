import { z } from 'zod';
import { definePackage, ready, unavailable } from '@catbots/node-kit';
const sizingPackage=definePackage('@catbots/nodes-risk',[{
  type:'risk.position_size',version:1,category:'risk',title:'Size from stop loss',
  config:z.object({riskPercent:z.number().positive().max(100),maxNotional:z.number().positive()}).strict(),inputs:{equity:'number',entry:'number',stop:'number'},outputs:{quantity:'number'},
  evaluate(input,config){const equity=input.equity.value as number,entry=input.entry.value as number,stop=input.stop.value as number;
    if(Object.values(input).some(v=>v.quality!=='ready')||equity<=0||entry<=0||stop<=0||entry===stop)return {outputs:{quantity:unavailable('number','Equity, entry and distinct stop prices are required')}};
    const quantity=Math.min(equity*config.riskPercent/100/Math.abs(entry-stop),config.maxNotional/entry);
    return {outputs:{quantity:ready('number',quantity)}};
  },
}]);


export const trailingDefinition: import('@catbots/node-kit').FlowDefinition = {
  type:'risk.trailing_exit',version:1,category:'risk',title:'Trailing exit',
  config:z.object({side:z.enum(['long','short']),activationPercent:z.number().nonnegative().max(100),callbackPercent:z.number().positive().max(100)}).strict(),
  inputs:{entry:'number',price:'number'},outputs:{exit:'condition',stop:'number'},
  evaluate(input,config,context,previous){
    const entry=input.entry.value as number,price=input.price.value as number;
    if(Object.values(input).some(value=>value.quality!=='ready')||entry<=0||price<=0)return {outputs:{exit:unavailable('condition','Price unavailable'),stop:unavailable('number','Price unavailable')}};
    const scope=JSON.stringify([context.deploymentId,context.market,entry,config]);
    const prior=previous as {scope:string;armed:boolean;extreme:number}|undefined;
    if(prior&&prior.scope!==scope)throw new Error('Trailing state belongs to another position');
    const sign=config.side==='long'?1:-1;
    const armed=(prior?.armed??false)||sign*(price-entry)/entry*100>=config.activationPercent;
    const extreme=armed?(config.side==='long'?Math.max(prior?.extreme??price,price):Math.min(prior?.extreme??price,price)):price;
    const stop=extreme*(1-sign*config.callbackPercent/100);
    return {state:{scope,armed,extreme},outputs:{exit:ready('condition',armed&&sign*(price-stop)<=0),stop:armed?ready('number',stop):unavailable('number','Trailing not activated')}};
  },
};

export const riskPackage=definePackage('@catbots/nodes-risk',[...sizingPackage.definitions,trailingDefinition]);
