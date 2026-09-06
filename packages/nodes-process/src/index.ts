import { itemDefinitions } from './items';
import { z } from 'zod';
import { definePackage, ready, unavailable } from '@catbots/node-kit';
export const processPackage=definePackage('@catbots/nodes-process',[{
  type:'process.number',version:1,category:'process',title:'Number',config:z.object({value:z.number().finite()}).strict(),inputs:{},outputs:{value:'number'},evaluate:(_input,config)=>({outputs:{value:ready('number',config.value)}}),
},{
  type:'process.math',version:1,category:'process',title:'Calculate',config:z.object({operator:z.enum(['add','subtract','multiply','divide'])}).strict(),inputs:{left:'number',right:'number'},outputs:{value:'number'},
  evaluate(input,config){const a=input.left.value as number,b=input.right.value as number;const value=config.operator==='add'?a+b:config.operator==='subtract'?a-b:config.operator==='multiply'?a*b:a/b;return {outputs:{value:Object.values(input).every(v=>v.quality==='ready')&&Number.isFinite(value)?ready('number',value):unavailable('number','Calculation unavailable')}};},
}, ...itemDefinitions]);
