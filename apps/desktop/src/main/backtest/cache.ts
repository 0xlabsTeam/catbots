import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serializeCanonicalJson, type JsonValue } from '@catbots/strategy-runtime';
export const hash = (value: unknown) => createHash('sha256').update(serializeCanonicalJson(value as JsonValue)).digest('hex');
/** Bounded disk cache. No failed/incomplete requests are written. */
export class BacktestCache {
  constructor(private directory: string, private maxBytes=64*1024*1024) {}
  async get<T>(key: string, ttl: number): Promise<T | undefined> {
    try {
      const file=join(this.directory,`${key}.json`), meta=await stat(file);
      if(meta.size>16*1024*1024 || Date.now()-meta.mtimeMs>ttl) return;
      const entry=JSON.parse(await readFile(file,'utf8'));
      if(entry.checksum!==hash(entry.value)) return;
      return entry.value as T;
    } catch { return; }
  }
  async set(key:string,value:unknown) {
    await mkdir(this.directory,{recursive:true});
    const text=JSON.stringify({checksum:hash(value),value});
    if(Buffer.byteLength(text)>16*1024*1024) return;
    const temp=join(this.directory,`${key}.${randomUUID()}.tmp`);
    try { await writeFile(temp,text,{mode:0o600});await rename(temp,join(this.directory,`${key}.json`)); } finally { await unlink(temp).catch(()=>{}); }
    const entries=await Promise.all((await readdir(this.directory)).filter(name=>name.endsWith('.json')).map(async name=>{const path=join(this.directory,name);return {path,meta:await stat(path).catch(()=>null)};}));
    const valid=entries.filter(entry=>entry.meta!==null).sort((a,b)=>b.meta!.mtimeMs-a.meta!.mtimeMs);
    let bytes=0; for(let index=0;index<valid.length;index++){bytes+=valid[index].meta!.size;if(index>=32 || bytes>this.maxBytes) await unlink(valid[index].path).catch(()=>{});}
  }
}
