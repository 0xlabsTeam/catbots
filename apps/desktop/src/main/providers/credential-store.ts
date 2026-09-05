import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Credential, CredentialStore } from '@earendil-works/pi-ai';

/** One app process owns this encrypted store; every mutation, including refresh, is serialized. */
export class EncryptedCredentialStore implements CredentialStore {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private path: string, private codec: { encrypt(value: string): Buffer; decrypt(value: Buffer): string }) {}
  private async load(): Promise<Record<string, Credential>> {
    try { return JSON.parse(this.codec.decrypt(await readFile(this.path))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw new Error('Credential storage unavailable'); }
  }
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const pending = this.chain.then(fn); this.chain = pending.catch(() => undefined); return pending;
  }
  private async save(data: Record<string, Credential>) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.tmp`;
    await writeFile(temp, this.codec.encrypt(JSON.stringify(data)), { mode: 0o600 });
    await rename(temp, this.path);
  }
  async read(id: string) { await this.chain; return (await this.load())[id]; }
  async list() { await this.chain; return Object.entries(await this.load()).map(([providerId, credential]) => ({ providerId, type: credential.type })); }
  modify(id: string, fn: (value: Credential | undefined) => Promise<Credential | undefined>) {
    return this.enqueue(async () => { const data = await this.load(); const value = await fn(data[id]); if (value) { data[id] = value; await this.save(data); } return data[id]; });
  }
  delete(id: string) { return this.enqueue(async () => { const data = await this.load(); delete data[id]; await this.save(data); }); }
}
