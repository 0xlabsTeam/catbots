import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createModels, type CredentialStore, type Provider, type AuthPrompt } from '@earendil-works/pi-ai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot';
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { radiusProvider } from '@earendil-works/pi-ai/providers/radius';
import { ProviderCommandSchema, type ProviderStatus } from '@catbots/contracts';
import type { NativeAgentTransport } from '../agent/agent-loop';

// Pi supplies static loaders for bundled runtimes; these flows use Node APIs in Electron.
registerBunOAuthFlows();

type Login = NonNullable<ProviderStatus['login']>;
export class ProviderService {
  readonly models;
  private login: Login | null = null;
  private controller?: AbortController;
  private answer?: { id: string; resolve(value: string): void; reject(error: Error): void };
  private selected: ProviderStatus['selected'] = null;
  private ready: Promise<void>;
  private operations: Promise<unknown> = Promise.resolve();
  constructor(private store: CredentialStore, private selectionPath: string, providers: Provider[] = [openaiCodexProvider(), anthropicProvider(), githubCopilotProvider(), xaiProvider(), openrouterProvider(), radiusProvider()], private openUrl?: (url: string) => Promise<void>) {
    // Do not read ambient API keys or the user's separate ~/.pi credentials.
    this.models = createModels({ credentials: store, authContext: { env: async () => undefined, fileExists: async () => false } });
    providers.forEach((provider) => this.models.setProvider(provider));
    this.ready = this.restore();
  }
  private async restore() {
    try {
      const value = JSON.parse(await readFile(this.selectionPath, 'utf8'));
      if (value !== null) { const parsed = ProviderCommandSchema.parse({ action: 'select', ...value }); if (parsed.action === 'select') this.selected = { provider: parsed.provider, model: parsed.model }; }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Provider selection unavailable'); }
  }
  private async saveSelection(value: ProviderStatus['selected']) {
    await mkdir(dirname(this.selectionPath), { recursive: true });
    await writeFile(`${this.selectionPath}.tmp`, JSON.stringify(value), { mode: 0o600 });
    await rename(`${this.selectionPath}.tmp`, this.selectionPath); this.selected = value;
  }
  async status(): Promise<ProviderStatus> {
    await this.ready;
    const connected = new Set((await this.store.list()).map((entry) => entry.providerId));
    return { selected: this.selected, login: this.login ? structuredClone(this.login) : null, providers: this.models.getProviders().map((provider) => ({
      id: provider.id, name: provider.name, connected: connected.has(provider.id), oauth: !!provider.auth.oauth, apiKey: !!provider.auth.apiKey?.login,
      models: provider.getModels().map(({ id, name }) => ({ id, name })),
    })) };
  }
  command(input: unknown): Promise<ProviderStatus> {
    const request = ProviderCommandSchema.parse(input);
    if (request.action === 'status') return this.status();
    const pending = this.operations.then(() => this.execute(request));
    this.operations = pending.catch(() => undefined);
    return pending;
  }
  private async execute(input: unknown): Promise<ProviderStatus> {
    const request = ProviderCommandSchema.parse(input); await this.ready;
    if (request.action === 'login') {
      if (this.login?.state === 'waiting') throw new Error('Login already in progress');
      const provider = this.models.getProvider(request.provider);
      const flow = request.method === 'oauth' ? provider?.auth.oauth : provider?.auth.apiKey;
      if (!flow?.login) throw new Error('Login method unavailable');
      const controller = new AbortController(); this.controller = controller;
      const login: Login = { id: randomUUID(), provider: request.provider, state: 'waiting', message: 'Starting sign-in…' }; this.login = login;
      const timeout = setTimeout(() => controller.abort(), 600000);
      void flow.login({ signal: controller.signal, prompt: (prompt) => this.prompt(login, prompt, controller.signal), notify: (event) => {
        if (controller.signal.aborted) return;
        if (event.type === 'auth_url') { login.url = safeAuthUrl(event.url); login.message = 'Use Open provider sign-in to continue in your browser.'; }
        else if (event.type === 'device_code') { login.url = safeAuthUrl(event.verificationUri); login.userCode = event.userCode; login.message = 'Enter this code on the provider website.'; }
        else login.message = event.message;
      } }).then(async (credential) => {
        if (controller.signal.aborted) return;
        await this.store.modify(request.provider, async (current) => controller.signal.aborted ? current : credential);
        if (controller.signal.aborted) return;
        login.state = 'completed'; login.message = 'Connected. Choose a model to use for chat.';
        await this.models.refresh({ providers: [request.provider], signal: controller.signal });
      }).catch(() => { login.state = controller.signal.aborted ? 'cancelled' : 'failed'; login.message = controller.signal.aborted ? 'Sign-in cancelled.' : 'Sign-in failed. Please try again.'; }).finally(() => {
        clearTimeout(timeout); delete login.prompt; delete login.url; delete login.userCode;
        if (this.login === login) this.answer = undefined;
      });
    } else if (request.action === 'open-login') {
      if (this.login?.id !== request.sessionId || this.login.state !== 'waiting' || !this.login.url || !this.openUrl) throw new Error('Sign-in link unavailable');
      await this.openUrl(safeAuthUrl(this.login.url));
    } else if (request.action === 'reply') {
      if (this.login?.id !== request.sessionId || this.answer?.id !== request.promptId || this.login.state !== 'waiting') throw new Error('Sign-in prompt expired');
      const prompt = this.login.prompt;
      if (prompt?.type === 'select' && !prompt.options?.some((option) => option.id === request.value)) throw new Error('Invalid selection');
      this.answer.resolve(request.value); this.answer = undefined; delete this.login.prompt;
    } else if (request.action === 'cancel') {
      if (this.login?.id === request.sessionId) { this.controller?.abort(); this.login.state = 'cancelled'; this.answer?.reject(new Error('Cancelled')); this.answer = undefined; delete this.login.prompt; delete this.login.url; delete this.login.userCode; }
    } else if (request.action === 'logout') {
      if (this.login?.provider === request.provider && this.login.state === 'waiting') throw new Error('Cancel sign-in first');
      await this.models.logout(request.provider);
      if (this.selected?.provider === request.provider) await this.saveSelection(null);
    } else if (request.action === 'select') {
      if (!await this.store.read(request.provider)) throw new Error('Connect this provider first');
      if (!this.models.getModel(request.provider, request.model)) throw new Error('Model unavailable');
      await this.saveSelection({ provider: request.provider, model: request.model });
    } else if (request.action === 'compatible') await this.saveSelection(null);
    else if (request.action === 'refresh') await this.models.refresh({ force: true, signal: AbortSignal.timeout(30000) });
    return this.status();
  }
  private prompt(login: Login, prompt: AuthPrompt, signal: AbortSignal): Promise<string> {
    if (signal.aborted || prompt.signal?.aborted) return Promise.reject(new Error('Cancelled'));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const cleanup = () => { signal.removeEventListener('abort', abort); prompt.signal?.removeEventListener('abort', abort); if (login.prompt?.id === id) delete login.prompt; };
      const abort = () => { cleanup(); reject(new Error('Cancelled')); };
      this.answer = { id, resolve: (value) => { cleanup(); resolve(value); }, reject: (error) => { cleanup(); reject(error); } };
      login.prompt = { id, type: prompt.type, message: prompt.message, ...(prompt.type === 'select' ? { options: [...prompt.options] } : {}) };
      signal.addEventListener('abort', abort, { once: true }); prompt.signal?.addEventListener('abort', abort, { once: true });
    });
  }
  async transport(): Promise<NativeAgentTransport | null> {
    await this.ready;
    if (!this.selected) return null;
    const { provider, model: id } = this.selected;
    if (!await this.store.read(provider)) throw new Error('Provider disconnected');
    let model = this.models.getModel(provider, id);
    if (!model) { await this.models.refresh({ providers: [provider], signal: AbortSignal.timeout(30000) }); model = this.models.getModel(provider, id); }
    if (!model) throw new Error('Model unavailable');
    return { model, stream: (_model, context, options) => this.models.streamSimple(model!, context, options) };
  }
}
function safeAuthUrl(value: string): string {
  const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid sign-in URL'); return url.href;
}
