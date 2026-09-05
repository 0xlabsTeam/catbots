import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { evaluatePackagedFlow, listRuntimePackages, serializeCanonicalJson, type FlowContext, type FlowDocument, type FlowRun, type JsonValue } from '@catbots/strategy-runtime';
type Entry = { fingerprint:string; at:number; state:Record<string,unknown>; runs:Record<string,{inputHash:string;result:FlowRun}> };
type Journal = { version:1; deployments:Record<string,Entry> };
function hash(value:unknown) { return createHash('sha256').update(serializeCanonicalJson(JSON.parse(JSON.stringify(value)) as JsonValue)).digest('hex'); }
/** Local simulation journal. No order dispatch capability; state and proposed orders commit together. */
export class FlowJournal {
  constructor(private path:string) {}
  evaluate(document:FlowDocument,context:FlowContext):FlowRun {
    mkdirSync(dirname(this.path),{recursive:true});
    const lockPath=`${this.path}.lock`;
    const lock=openSync(lockPath,'wx',0o600);
    try {
      const data:Journal=existsSync(this.path)?JSON.parse(readFileSync(this.path,'utf8')):{version:1,deployments:{}};
      if(data.version!==1||!data.deployments||typeof data.deployments!=='object')throw new Error('Invalid simulation journal');
      const key=hash([context.deploymentId,context.market]);
      const fingerprint=hash([document,listRuntimePackages()]);
      const inputHash=hash(context);
      let entry=data.deployments[key];
      if(entry&&entry.fingerprint!==fingerprint)throw new Error('Create a new deployment for another graph or package version');
      const runKey=hash(context.runId);
      if(entry?.runs[runKey]){if(entry.runs[runKey].inputHash!==inputHash)throw new Error('Run ID already used with different input');return structuredClone(entry.runs[runKey].result);}
      if(entry&&context.at<entry.at)throw new Error('Simulation time cannot go backwards');
      if(entry&&Object.keys(entry.runs).length>=1000)throw new Error('Simulation journal limit reached; create another deployment');
      const result=evaluatePackagedFlow(document,context,entry?.state);
      entry={fingerprint,at:context.at,state:result.state,runs:{...entry?.runs,[runKey]:{inputHash,result}}};
      data.deployments[key]=entry;
      const temp=`${this.path}.tmp`;
      const descriptor=openSync(temp,'w',0o600);
      try{writeFileSync(descriptor,JSON.stringify(data));fsyncSync(descriptor);}finally{closeSync(descriptor);}
      renameSync(temp,this.path);
      return structuredClone(result);
    }finally{closeSync(lock);unlinkSync(lockPath);}
  }
}
