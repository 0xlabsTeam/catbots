import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { ProviderService } from '../src/main/providers/provider-service';
import { EncryptedCredentialStore } from '../src/main/providers/credential-store';
const directories: string[] = [];
async function location() { const dir = await mkdtemp(join(tmpdir(), 'catbots-provider-')); directories.push(dir); return dir; }
afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const credential = { type: 'oauth' as const, access: 'private-access-token', refresh: 'private-refresh-token', expires: Date.now() + 3600000 };

describe('provider accounts', () => {
  it('completes interactive login, keeps tokens out of status, selects a real model and restores selection', async () => {
    const provider = anthropicProvider();
    provider.auth.oauth = { ...provider.auth.oauth!, login: async (interaction) => {
      interaction.notify({ type: 'auth_url', url: 'https://example.com/login' });
      expect(await interaction.prompt({ type: 'manual_code', message: 'Paste code' })).toBe('accepted');
      return credential;
    } };
    const store = new InMemoryCredentialStore(); const path = join(await location(), 'selection.json');
    const service = new ProviderService(store, path, [provider]);
    let status = await service.command({ action: 'login', provider: 'anthropic', method: 'oauth' });
    expect(status.login?.url).toBe('https://example.com/login');
    await service.command({ action: 'reply', sessionId: status.login!.id, promptId: status.login!.prompt!.id, value: 'accepted' });
    await vi.waitFor(async () => expect((await service.status()).login?.state).toBe('completed'));
    status = await service.status(); expect(JSON.stringify(status)).not.toContain('private-');
    const model = status.providers[0]!.models[0]!.id;
    await service.command({ action: 'select', provider: 'anthropic', model });
    expect((await new ProviderService(store, path, [provider]).transport())?.model.id).toBe(model);
    await service.command({ action: 'logout', provider: 'anthropic' });
    expect(await store.read('anthropic')).toBeUndefined(); expect((await service.status()).selected).toBeNull();
  });
  it('rejects stale prompt replies and prevents a cancelled login from saving tokens', async () => {
    const provider = anthropicProvider(); let finish!: () => void;
    provider.auth.oauth = { ...provider.auth.oauth!, login: async () => { await new Promise<void>((resolve) => { finish = resolve; }); return credential; } };
    const store = new InMemoryCredentialStore(); const service = new ProviderService(store, join(await location(), 'selection.json'), [provider]);
    const status = await service.command({ action: 'login', provider: 'anthropic', method: 'oauth' });
    await service.command({ action: 'cancel', sessionId: status.login!.id }); finish();
    await expect(service.command({ action: 'reply', sessionId: status.login!.id, promptId: status.login!.id, value: 'code' })).rejects.toThrow();
    expect(await store.read('anthropic')).toBeUndefined();
  });
  it('uses Pi locked token refresh before resolving auth', async () => {
    const provider = anthropicProvider(); const refresh = vi.fn(async () => credential);
    provider.auth.oauth = { ...provider.auth.oauth!, refresh, toAuth: async (value) => ({ apiKey: value.access }) };
    const store = new InMemoryCredentialStore(); await store.modify('anthropic', async () => ({ ...credential, expires: 1 }));
    const service = new ProviderService(store, join(await location(), 'selection.json'), [provider]);
    await Promise.all([service.models.getAuth('anthropic'), service.models.getAuth('anthropic')]);
    expect(refresh).toHaveBeenCalledTimes(1); expect((await store.read('anthropic'))).toMatchObject({ access: credential.access });
  });
  it('persists encrypted credentials with private permissions and serializes writes', async () => {
    const path = join(await location(), 'auth.enc');
    const codec = { encrypt: (value: string) => Buffer.from(Buffer.from(value).toString('base64')), decrypt: (value: Buffer) => Buffer.from(value.toString(), 'base64').toString() };
    const store = new EncryptedCredentialStore(path, codec);
    await Promise.all(['anthropic', 'openai-codex'].map((id) => store.modify(id, async () => credential)));
    expect((await readFile(path, 'utf8'))).not.toContain('private-access-token');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await new EncryptedCredentialStore(path, codec).list()).toHaveLength(2);
    await store.delete('anthropic'); expect(await store.read('anthropic')).toBeUndefined();
  });
});
