import { useEffect, useState } from 'react';
import { Banner, Button, Input, Select, Badge, LayerCard } from '@cloudflare/kumo';
import type { CatbotsDesktopApi, ProviderCommand, ProviderStatus } from '@catbots/contracts';

type Props = { api: NonNullable<CatbotsDesktopApi['providers']>; onSelected?(): void };
export function ProviderConnections({ api, onSelected }: Props) {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [provider, setProvider] = useState('openai-codex');
  const [model, setModel] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = status?.providers.find((item) => item.id === provider);
  const login = status?.login;
  const waiting = login?.state === 'waiting';
  useEffect(() => {
    let active = true;
    const update = () => api.command({ action: 'status' }).then((next) => { if (active) setStatus(next); }).catch(() => { if (active) setError('Could not load provider connections.'); });
    void update(); const timer = window.setInterval(() => { if (active) void update(); }, waiting ? 1000 : 15000);
    return () => { active = false; clearInterval(timer); };
  }, [api, waiting]);
  useEffect(() => { setValue(login?.prompt?.type === 'select' ? login.prompt.options?.[0]?.id ?? '' : ''); }, [login?.prompt?.id]);
  const command = async (input: ProviderCommand) => {
    setBusy(true); setError('');
    try { const next = await api.command(input); setStatus(next); if (input.action === 'select') onSelected?.(); }
    catch { setError('The operation could not be completed. Check the connection and try again.'); }
    finally { setBusy(false); }
  };
  const providerId = provider as Extract<ProviderCommand, { action: 'login' }>['provider'];
  return <LayerCard render={<section aria-labelledby="provider-connections-title" />} className="settings-card provider-connections">
    <header><h2 id="provider-connections-title">AI providers</h2><p>Connect a subscription or API key, then choose the model for chat.</p></header>
    {status?.selected ? <p><Badge variant="secondary">Active</Badge> {status.selected.provider} · {status.selected.model}</p> : <p>Chat uses your compatible API settings until you select a connected model.</p>}
    {error && <Banner variant="error" title="Provider connection" description={error} />}
    <Select size="base" className="provider-select" label="Subscription provider" renderValue={(id) => status?.providers.find((item) => item.id === id)?.name ?? String(id)} value={provider} onValueChange={(next) => { setProvider(String(next)); setModel(''); }} disabled={busy || waiting}>
      {(status?.providers ?? []).map((item) => <Select.Option key={item.id} value={item.id}>{item.name}{item.connected ? ' · Connected' : ''}</Select.Option>)}
    </Select>
    {provider === 'anthropic' && <p>Claude Pro/Max access uses extra usage billed per token, separately from plan limits.</p>}
    {provider === 'openrouter' && <p>Sign-in creates an API key billed from your OpenRouter credits. Signing out here removes the local key; revoke it in OpenRouter to invalidate it.</p>}
    {provider === 'openai-codex' && <p>Connect your ChatGPT Plus/Pro account through Codex sign-in.</p>}
    <div className="provider-actions">
      {current?.oauth && <Button size="base" variant="primary" disabled={busy || waiting} onClick={() => void command({ action: 'login', provider: providerId, method: 'oauth' })}>Sign in{current.connected ? ' again' : ''}</Button>}
      {current?.apiKey && <Button size="base" variant="secondary" disabled={busy || waiting} onClick={() => void command({ action: 'login', provider: providerId, method: 'api_key' })}>Use API key</Button>}
      {current?.connected && <Button size="base" variant="secondary" disabled={busy || waiting} onClick={() => void command({ action: 'logout', provider: providerId })}>Sign out</Button>}
    </div>
    {login && <LayerCard className="provider-login">
      <p role="status">{login.message}</p>
      {waiting && login.url && <Button size="base" variant="secondary" disabled={busy} onClick={() => void command({ action: 'open-login', sessionId: login.id })}>Open provider sign-in</Button>}
      {waiting && login.userCode && <p>Verification code: <strong>{login.userCode}</strong></p>}
      {waiting && login.prompt && <form className="provider-login-form" onSubmit={(event) => { event.preventDefault(); void command({ action: 'reply', sessionId: login.id, promptId: login.prompt!.id, value }); setValue(''); }}>
        {login.prompt.type === 'select' ? <Select size="base" className="provider-select" label={login.prompt.message} placeholder="Choose a sign-in method" renderValue={(id) => login.prompt?.options?.find((option) => option.id === id)?.label ?? String(id)} value={value} onValueChange={(next) => setValue(String(next))}>
          {login.prompt.options?.map((option) => <Select.Option key={option.id} value={option.id}>{option.label}</Select.Option>)}
        </Select> : <Input size="base" label={login.prompt.message} type={login.prompt.type === 'secret' ? 'password' : 'text'} value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" />}
        <Button size="base" type="submit" variant="primary" disabled={busy || (login.prompt.type === 'select' && !value)}>Continue</Button>
      </form>}
      {waiting && <Button size="base" variant="secondary" disabled={busy} onClick={() => void command({ action: 'cancel', sessionId: login.id })}>Cancel sign-in</Button>}
    </LayerCard>}
    {current?.connected && <>
      <Select size="base" className="provider-select" label="Chat model" placeholder="Choose a model" renderValue={(id) => current.models.find((item) => item.id === id)?.name ?? String(id)} value={model} onValueChange={(next) => setModel(String(next))}>
        {current.models.map((item) => <Select.Option key={item.id} value={item.id}>{item.name}</Select.Option>)}
      </Select>
      <div className="provider-actions"><Button size="base" variant="primary" disabled={busy || waiting || !model} onClick={() => void command({ action: 'select', provider: providerId, model })}>Use for chat</Button><Button size="base" variant="secondary" disabled={busy || waiting} onClick={() => void command({ action: 'refresh' })}>Refresh models</Button></div>
    </>}
    {status?.selected && <Button size="base" variant="ghost" disabled={busy || waiting} onClick={() => void command({ action: 'compatible' })}>Use compatible API settings instead</Button>}
    <p>Credentials are encrypted in this Catbots profile and shared by its web and desktop interfaces.</p>
  </LayerCard>;
}
