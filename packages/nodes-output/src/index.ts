import { z } from 'zod';
import { definePackage } from '@catbots/node-kit';
export const outputPackage=definePackage('@catbots/nodes-output',[{
  type:'output.number',version:1,category:'output',title:'Inspect value',config:z.object({}).strict(),inputs:{value:'number'},outputs:{value:'number'},evaluate:input=>({outputs:{value:input.value}}),
},{type:'output.condition',version:1,category:'output',title:'Inspect condition',config:z.object({}).strict(),inputs:{value:'condition'},outputs:{value:'condition'},evaluate:input=>({outputs:{value:input.value}})}]);
