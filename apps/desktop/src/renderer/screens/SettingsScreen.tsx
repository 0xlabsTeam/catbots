import { useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Banner, Button, Dialog, Input, Select, Switch, Tooltip } from '@cloudflare/kumo';
import { Progress } from '@cloudflare/kumo/primitives/progress';
import { CheckCircleIcon, DesktopTowerIcon, InfoIcon, LockKeyIcon } from '@phosphor-icons/react';
import type { CatbotsDesktopApi, LocalConfig, RedactedLocalConfig } from '@catbots/contracts';
import { ConnectionTestStatus, type ConnectionTestState } from '../components/ConnectionTestStatus';
import { SecretField } from '../components/SecretField';

type Provider = LocalConfig['llm']['provider'];
type SettingsScreenProps = { api: CatbotsDesktopApi['config']; config?: RedactedLocalConfig; repairIssues?: ReadonlyArray<{ path: string; message: string }>; onboarding?: boolean; onSaved?(config: RedactedLocalConfig): void };
type FormState = { profileName: string; telemetry: boolean; provider: Provider; baseUrl: string; apiKey: string; model: string };
type FormErrors = Partial<Record<keyof FormState, string>>;

const SAFE_REPAIR_PATHS = new Set(['profile.name', 'profile.telemetry', 'llm.provider', 'llm.baseUrl', 'llm.apiKey', 'llm.model']);

function formFromConfig(config?: RedactedLocalConfig): FormState {
  return { profileName: config?.profile.name ?? '', telemetry: config?.profile.telemetry ?? false, provider: config?.llm.provider ?? 'openai-compatible', baseUrl: config?.llm.baseUrl ?? '', apiKey: '', model: config?.llm.model ?? '' };
}

function isPermittedProviderUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(hostname));
  } catch { return false; }
}

function validate(state: FormState): FormErrors {
  const errors: FormErrors = {};
  if (state.profileName.trim().length === 0) errors.profileName = 'Enter a local profile name.';
  if (state.profileName.trim().length > 80) errors.profileName = 'Use 80 characters or fewer.';
  if (state.baseUrl.trim().length === 0) errors.baseUrl = 'Enter the provider URL.';
  else if (!isPermittedProviderUrl(state.baseUrl)) errors.baseUrl = 'Use HTTPS, or HTTP only for a provider on this computer.';
  if (state.apiKey.length === 0) errors.apiKey = 'Enter the API key to test and save this provider.';
  if (state.model.trim().length === 0) errors.model = 'Enter a model identifier.';
  return errors;
}

function toLocalConfig(state: FormState): LocalConfig {
  return { profile: { name: state.profileName.trim(), telemetry: state.telemetry }, llm: { provider: state.provider, baseUrl: state.baseUrl.trim(), apiKey: state.apiKey, model: state.model.trim() }, exchanges: {} };
}

function getSafeRepairPaths(issues: SettingsScreenProps['repairIssues']): string[] { return [...new Set((issues ?? []).flatMap((issue) => SAFE_REPAIR_PATHS.has(issue.path) ? [issue.path] : []))]; }

export function SettingsScreen({ api, config, repairIssues, onboarding = false, onSaved }: SettingsScreenProps) {
  const [form, setForm] = useState<FormState>(() => formFromConfig(config));
  const [errors, setErrors] = useState<FormErrors>({});
  const [connection, setConnection] = useState<ConnectionTestState>({ state: 'idle' });
  // Keep a revision marker, not a derivative of the API key, for test invalidation.
  const [providerRevision, setProviderRevision] = useState(0);
  const [testedProviderRevision, setTestedProviderRevision] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const safeRepairPaths = useMemo(() => getSafeRepairPaths(repairIssues), [repairIssues]);
  const hasPassedCurrentTest = testedProviderRevision === providerRevision;
  const submitLabel = onboarding ? 'Create local profile' : 'Save settings';

  const updateForm = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
    if (key === 'provider' || key === 'baseUrl' || key === 'apiKey' || key === 'model') {
      setProviderRevision((revision) => revision + 1);
      setTestedProviderRevision(null);
      setConnection({ state: 'idle' });
    }
  };
  const validateForm = (): boolean => { const nextErrors = validate(form); setErrors(nextErrors); return Object.keys(nextErrors).length === 0; };
  const testConnection = async (): Promise<boolean> => {
    if (!validateForm()) return false;
    const submittedRevision = providerRevision;
    setConnection({ state: 'testing' });
    try {
      const result = await api.testLlmConnection(toLocalConfig(form));
      if (result.ok) { setTestedProviderRevision(submittedRevision); setConnection({ state: 'success', model: result.model }); return true; }
      setTestedProviderRevision(null); setConnection({ state: 'error', message: result.message }); return false;
    } catch {
      setTestedProviderRevision(null); setConnection({ state: 'error', message: 'Connection testing is unavailable. Review the provider and try again.' }); return false;
    }
  };
  const save = async (): Promise<void> => {
    if (!validateForm()) return;
    if (testedProviderRevision !== providerRevision) { setConnection({ state: 'error', message: 'Test this provider again before saving changed values.' }); return; }
    setIsSaving(true);
    try {
      const savedConfig = await api.save(toLocalConfig(form));
      setForm((previous) => ({ ...previous, apiKey: '' }));
      setTestedProviderRevision(null);
      setConnection({ state: 'saved' });
      onSaved?.(savedConfig);
    } catch { setConnection({ state: 'error', message: 'Settings could not be saved. Your key remains only in this form so you can retry.' }); }
    finally { setIsSaving(false); }
  };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void save(); };
  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    void save();
  };

  return (
    <main className={onboarding ? 'setup-shell' : 'settings-shell'}>
      <section className="setup-intro" aria-labelledby="settings-heading">
        <div className="local-mark" aria-hidden="true"><DesktopTowerIcon weight="duotone" /></div>
        <p className="eyebrow">LOCAL DESKTOP</p>
        <h1 id="settings-heading">{onboarding ? 'Create your local profile' : 'Settings'}</h1>
        <p className="lead">{onboarding ? 'Set up a profile and connect an AI provider. Catbots has no cloud account and keeps this configuration on this computer.' : 'Update the local profile and AI provider used by this Catbots installation.'}</p>
        {onboarding ? <div className="setup-progress" aria-label="Setup progress"><Progress.Root value={2} max={2} aria-label="Setup progress: connect AI provider"><Progress.Label>Setup checkpoint</Progress.Label><Progress.Track><Progress.Indicator /></Progress.Track><Progress.Value /></Progress.Root><ol><li className="completed"><CheckCircleIcon aria-hidden="true" weight="fill" /> Local profile</li><li className="active">2 <span>Connect AI provider</span></li></ol></div> : null}
        <Banner className="local-trust-callout" variant="secondary" icon={<LockKeyIcon aria-hidden="true" weight="duotone" />} title="Your provider key stays local" description="It is sent only to the configured provider when you test it. Catbots never shows it again after saving." />
      </section>
      <section className="settings-card" aria-label={onboarding ? 'Local profile setup' : 'Local settings'}>
        {safeRepairPaths.length > 0 ? <Banner variant="alert" title="Configuration repair" description={<>Review these safe settings fields: {safeRepairPaths.map((path) => <code key={path}>{path}</code>)}</>} /> : null}
        <header className="form-heading"><p className="eyebrow">{onboarding ? 'STEP 2 OF 2' : 'AI PROVIDER'}</p><h2>{onboarding ? 'Connect your AI provider' : 'Provider connection'}</h2><p>A successful connection test is required before these provider values can be saved.</p></header>
        <form className="settings-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown} noValidate>
          <Input id="profile-name" label="Profile name" value={form.profileName} onChange={(event) => updateForm('profileName', event.currentTarget.value)} error={errors.profileName} autoComplete="off" />
          <Switch label="Anonymous telemetry" checked={form.telemetry} onCheckedChange={(value) => updateForm('telemetry', value)} required={false} />
          <Select<Provider> label="Provider" value={form.provider} onValueChange={(value) => updateForm('provider', value as Provider)} error={errors.provider}><Select.Option value="openai-compatible">OpenAI-compatible</Select.Option><Select.Option value="anthropic-compatible">Anthropic-compatible</Select.Option></Select>
          <Input id="base-url" label="Base URL" value={form.baseUrl} onChange={(event) => updateForm('baseUrl', event.currentTarget.value)} error={errors.baseUrl} placeholder="https://api.example.com/v1" autoComplete="url" spellCheck={false} description="Use HTTPS. HTTP is allowed only for localhost, 127.0.0.1, or ::1 on this computer." />
          <SecretField value={form.apiKey} onValueChange={(value) => updateForm('apiKey', value)} error={errors.apiKey} storedMask={config?.llm.apiKey} />
          <Input id="model" label="Model" value={form.model} onChange={(event) => updateForm('model', event.currentTarget.value)} error={errors.model} placeholder="provider/model" autoComplete="off" spellCheck={false} />
          <ConnectionTestStatus value={connection} />
          <div className="form-actions"><Tooltip content="Checks the URL, authentication, model availability, and a minimal provider request." render={<Button type="button" variant="secondary" onClick={() => void testConnection()} />}>Test connection</Tooltip><Button type="submit" variant="primary" disabled={!hasPassedCurrentTest || isSaving} loading={isSaving}>{submitLabel}</Button></div>
          <p className="form-footnote"><InfoIcon aria-hidden="true" /> Catbots has no in-app YAML editor. This form is the only way to save local configuration.</p>
        </form>
        <Dialog.Root><Dialog.Trigger render={(props) => <Button {...props} className="privacy-dialog-trigger" variant="ghost" size="sm">How is my key handled?</Button>} /><Dialog><Dialog.Title>Local-only credentials</Dialog.Title><Dialog.Description>Your key is held only by this password field until a successful local save. The stored value is never rendered again.</Dialog.Description><Dialog.Close render={(props) => <Button {...props} variant="secondary">Close</Button>} /></Dialog></Dialog.Root>
      </section>
    </main>
  );
}
