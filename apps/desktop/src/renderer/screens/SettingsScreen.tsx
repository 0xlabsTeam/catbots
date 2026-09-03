import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Banner, Button, Dialog, Input, Select, Switch, Tooltip } from '@cloudflare/kumo';
import { Progress } from '@cloudflare/kumo/primitives/progress';
import { CheckCircleIcon, DesktopTowerIcon, InfoIcon, LockKeyIcon } from '@phosphor-icons/react';
import {
  CompatibleProviderUrlSchema,
  hasSameLlmCredentialScope,
  normalizeLlmProviderBaseUrl,
  REDACTED_SECRET,
  type CatbotsDesktopApi,
  type LocalConfig,
  type LocalSettingsPatch,
  type RedactedLocalConfig,
} from '@catbots/contracts';
import { ConnectionTestStatus, mapExternalConnectionErrorCode, type ConnectionTestState } from '../components/ConnectionTestStatus';
import { SecretField } from '../components/SecretField';

type Provider = LocalConfig['llm']['provider'];
type SettingsScreenProps = { api: CatbotsDesktopApi['config']; config?: RedactedLocalConfig; repairIssues?: ReadonlyArray<{ path: string; message: string }>; onboarding?: boolean; embedded?: boolean; onSaved?(config: RedactedLocalConfig): void };
type FormState = { profileName: string; telemetry: boolean; provider: Provider; baseUrl: string; apiKey: string; model: string };
type FormErrors = Partial<Record<keyof FormState, string>>;

const SAFE_REPAIR_PATHS = new Set(['profile.name', 'profile.telemetry', 'llm.provider', 'llm.baseUrl', 'llm.apiKey', 'llm.model']);

function formFromConfig(config?: RedactedLocalConfig): FormState {
  return { profileName: config?.profile.name ?? '', telemetry: config?.profile.telemetry ?? false, provider: config?.llm.provider ?? 'openai-compatible', baseUrl: config?.llm.baseUrl ?? '', apiKey: '', model: config?.llm.model ?? '' };
}

function isPermittedProviderUrl(value: string): boolean {
  return CompatibleProviderUrlSchema.safeParse(value).success;
}

function hasChangedStoredCredentialScope(state: FormState, config?: RedactedLocalConfig): boolean {
  if (config === undefined) return false;
  const baseUrl = state.baseUrl.trim();
  if (!isPermittedProviderUrl(baseUrl)) return false;
  return !hasSameLlmCredentialScope(config.llm, { provider: state.provider, baseUrl });
}

function connectionApprovalBinding(state: FormState, replacementKeyRevision: number): string | null {
  const baseUrl = state.baseUrl.trim();
  if (!isPermittedProviderUrl(baseUrl)) return null;
  return JSON.stringify({
    provider: state.provider,
    baseUrl: normalizeLlmProviderBaseUrl(baseUrl),
    model: state.model.trim(),
    credential: state.apiKey.length === 0 ? 'existing' : `replacement:${replacementKeyRevision}`,
  });
}

function validate(state: FormState, requiresApiKey: boolean): FormErrors {
  const errors: FormErrors = {};
  if (state.profileName.trim().length === 0) errors.profileName = 'Enter a local profile name.';
  if (state.profileName.trim().length > 80) errors.profileName = 'Use 80 characters or fewer.';
  if (state.baseUrl.trim().length === 0) errors.baseUrl = 'Enter the provider URL.';
  else if (!isPermittedProviderUrl(state.baseUrl)) errors.baseUrl = 'Use HTTPS, or HTTP only for a provider on this computer.';
  if (requiresApiKey && state.apiKey.length === 0) errors.apiKey = 'Enter the API key to test and save this provider.';
  if (state.apiKey === REDACTED_SECRET) errors.apiKey = 'Enter a real API key, not the stored-key mask.';
  if (state.model.trim().length === 0) errors.model = 'Enter a model identifier.';
  return errors;
}

function toSettingsPatch(state: FormState): LocalSettingsPatch {
  return {
    profile: { name: state.profileName.trim(), telemetry: state.telemetry },
    llm: {
      provider: state.provider,
      baseUrl: state.baseUrl.trim(),
      model: state.model.trim(),
      ...(state.apiKey.length === 0 ? {} : { apiKey: state.apiKey }),
    },
  };
}

function getSafeRepairPaths(issues: SettingsScreenProps['repairIssues']): string[] { return [...new Set((issues ?? []).flatMap((issue) => SAFE_REPAIR_PATHS.has(issue.path) ? [issue.path] : []))]; }

export function SettingsScreen({ api, config, repairIssues, onboarding = false, embedded = false, onSaved }: SettingsScreenProps) {
  const [form, setForm] = useState<FormState>(() => formFromConfig(config));
  const [errors, setErrors] = useState<FormErrors>({});
  const [connection, setConnection] = useState<ConnectionTestState>({ state: 'idle' });
  const [replacementKeyRevision, setReplacementKeyRevision] = useState(0);
  const [testedConnectionBinding, setTestedConnectionBinding] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const mountedRef = useRef(true);
  const formRevisionRef = useRef(0);
  const providerRevisionRef = useRef(0);
  const replacementKeyRevisionRef = useRef(0);
  const testRequestTokenRef = useRef(0);
  const isTestingRef = useRef(false);
  const saveRequestTokenRef = useRef(0);
  const isSavingRef = useRef(false);
  const safeRepairPaths = useMemo(() => getSafeRepairPaths(repairIssues), [repairIssues]);
  const credentialScopeChanged = hasChangedStoredCredentialScope(form, config);
  const requiresApiKey = config === undefined || credentialScopeChanged;
  const isRequiredApiKeyMissing = requiresApiKey && form.apiKey.length === 0;
  const currentConnectionBinding = connectionApprovalBinding(form, replacementKeyRevision);
  const hasPassedCurrentTest = testedConnectionBinding !== null
    && testedConnectionBinding === currentConnectionBinding
    && !isRequiredApiKeyMissing
    && form.apiKey !== REDACTED_SECRET;
  const submitLabel = onboarding ? 'Create local profile' : 'Save settings';

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const updateForm = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    if (isSavingRef.current) return;
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
    formRevisionRef.current += 1;
    if (key === 'provider' || key === 'baseUrl' || key === 'apiKey' || key === 'model') {
      const nextProviderRevision = providerRevisionRef.current + 1;
      providerRevisionRef.current = nextProviderRevision;
      if (key === 'apiKey') {
        const nextReplacementKeyRevision = replacementKeyRevisionRef.current + 1;
        replacementKeyRevisionRef.current = nextReplacementKeyRevision;
        setReplacementKeyRevision(nextReplacementKeyRevision);
      }
      testRequestTokenRef.current += 1;
      isTestingRef.current = false;
      setIsTesting(false);
      setConnection({ state: 'idle' });
    }
  };
  const validateForm = (): boolean => { const nextErrors = validate(form, requiresApiKey); setErrors(nextErrors); return Object.keys(nextErrors).length === 0; };
  const testConnection = async (): Promise<boolean> => {
    if (isTestingRef.current || isSavingRef.current) return false;
    if (!validateForm()) return false;
    const token = testRequestTokenRef.current + 1;
    testRequestTokenRef.current = token;
    const submittedProviderRevision = providerRevisionRef.current;
    const submittedConnectionBinding = connectionApprovalBinding(form, replacementKeyRevisionRef.current);
    if (submittedConnectionBinding === null) return false;
    const submittedPatch = toSettingsPatch(form);
    isTestingRef.current = true;
    setTestedConnectionBinding(null);
    setIsTesting(true);
    setConnection({ state: 'testing' });
    try {
      const result = await api.testLlmConnection(submittedPatch);
      if (!mountedRef.current || token !== testRequestTokenRef.current || submittedProviderRevision !== providerRevisionRef.current) return false;
      if (result.ok) { setTestedConnectionBinding(submittedConnectionBinding); setConnection({ state: 'success', model: submittedPatch.llm.model }); return true; }
      setTestedConnectionBinding(null); setConnection({ state: 'error', code: mapExternalConnectionErrorCode(result.code) }); return false;
    } catch {
      if (!mountedRef.current || token !== testRequestTokenRef.current || submittedProviderRevision !== providerRevisionRef.current) return false;
      setTestedConnectionBinding(null); setConnection({ state: 'error', code: 'connection-failed' }); return false;
    } finally {
      if (mountedRef.current && token === testRequestTokenRef.current) setIsTesting(false);
      if (token === testRequestTokenRef.current) isTestingRef.current = false;
    }
  };
  const save = async (): Promise<void> => {
    if (isSavingRef.current) return;
    if (!validateForm()) return;
    if (testedConnectionBinding === null || testedConnectionBinding !== currentConnectionBinding) { setConnection({ state: 'error', code: 'test-required' }); return; }
    const token = saveRequestTokenRef.current + 1;
    saveRequestTokenRef.current = token;
    const submittedRevision = formRevisionRef.current;
    const submittedPatch = toSettingsPatch(form);
    isSavingRef.current = true;
    setIsSaving(true);
    try {
      const savedConfig = await api.patchSettings(submittedPatch);
      if (!mountedRef.current || token !== saveRequestTokenRef.current || submittedRevision !== formRevisionRef.current) return;
      setForm((previous) => ({ ...previous, apiKey: '' }));
      setTestedConnectionBinding(null);
      setConnection({ state: 'saved' });
      onSaved?.(savedConfig);
    } catch {
      if (mountedRef.current && token === saveRequestTokenRef.current && submittedRevision === formRevisionRef.current) {
        setConnection({ state: 'error', code: 'save-failed' });
      }
    } finally {
      if (token === saveRequestTokenRef.current) isSavingRef.current = false;
      if (mountedRef.current && token === saveRequestTokenRef.current) setIsSaving(false);
    }
  };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void save(); };
  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    void save();
  };

  const Root = embedded ? 'div' : 'main';

  return (
    <Root className={onboarding ? 'setup-shell' : 'settings-shell'}>
      <section className="setup-intro" aria-labelledby="settings-heading">
        <div className="local-mark" aria-hidden="true"><DesktopTowerIcon weight="duotone" /></div>
        <p className="eyebrow">LOCAL DESKTOP</p>
        <h1 id="settings-heading">{onboarding ? 'Create your local profile' : 'Settings'}</h1>
        <p className="lead">{onboarding ? 'Set up a profile and connect an AI provider. Catbots has no cloud account and keeps this configuration on this computer.' : 'Update the local profile and AI provider used by this Catbots installation.'}</p>
        {onboarding ? <div className="setup-progress" aria-label="Setup progress"><Progress.Root value={2} max={2} aria-label="Setup progress: connect AI provider"><Progress.Label>Setup checkpoint</Progress.Label><Progress.Track><Progress.Indicator /></Progress.Track><Progress.Value /></Progress.Root><ol><li className="completed"><CheckCircleIcon aria-hidden="true" weight="fill" /> Local profile</li><li className="active">2 <span>Connect AI provider</span></li></ol></div> : null}
        <Banner className="local-trust-callout" variant="secondary" icon={<LockKeyIcon aria-hidden="true" weight="duotone" />} title="Your provider key stays local" description="It is sent only to the configured provider when you test it. Catbots never shows it again after saving." />
      </section>
      <section className="settings-card" aria-label={onboarding ? 'Local profile setup' : 'Local settings'}>
        {repairIssues === undefined ? null : <Banner variant="alert" title="Configuration repair" description={safeRepairPaths.length === 0 ? 'Re-enter the local profile and provider values to repair this configuration.' : <>Review these safe settings fields: {safeRepairPaths.map((path) => <code key={path}>{path}</code>)}</>} />}
        <header className="form-heading"><p className="eyebrow">{onboarding ? 'STEP 2 OF 2' : 'AI PROVIDER'}</p><h2>{onboarding ? 'Connect your AI provider' : 'Provider connection'}</h2><p>A successful connection test is required before these provider values can be saved.</p></header>
        <form className="settings-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown} noValidate>
          <Input id="profile-name" label="Profile name" value={form.profileName} onChange={(event) => updateForm('profileName', event.currentTarget.value)} variant={errors.profileName === undefined ? 'default' : 'error'} aria-invalid={errors.profileName === undefined ? undefined : true} aria-describedby={errors.profileName === undefined ? undefined : 'profile-name-error'} autoComplete="off" disabled={isSaving} />
          {errors.profileName === undefined ? null : <p id="profile-name-error" role="alert">{errors.profileName}</p>}
          <Switch label="Anonymous telemetry" checked={form.telemetry} onCheckedChange={(value) => updateForm('telemetry', value)} required={false} disabled={isSaving} />
          <Select<Provider> label="Provider" value={form.provider} onValueChange={(value) => updateForm('provider', value as Provider)} error={errors.provider} disabled={isSaving}><Select.Option value="openai-compatible">OpenAI-compatible</Select.Option><Select.Option value="anthropic-compatible">Anthropic-compatible</Select.Option></Select>
          <Input id="base-url" label="Base URL" value={form.baseUrl} onChange={(event) => updateForm('baseUrl', event.currentTarget.value)} variant={errors.baseUrl === undefined ? 'default' : 'error'} aria-invalid={errors.baseUrl === undefined ? undefined : true} aria-describedby={errors.baseUrl === undefined ? undefined : 'base-url-error'} placeholder="https://api.example.com/v1" autoComplete="url" spellCheck={false} description="Use HTTPS. HTTP is allowed only for localhost, 127.0.0.1, or ::1 on this computer." disabled={isSaving} />
          {errors.baseUrl === undefined ? null : <p id="base-url-error" role="alert">{errors.baseUrl}</p>}
          <SecretField value={form.apiKey} onValueChange={(value) => updateForm('apiKey', value)} error={errors.apiKey} storedMask={config?.llm.apiKey} requiresReplacement={credentialScopeChanged} disabled={isSaving} />
          <Input id="model" label="Model" value={form.model} onChange={(event) => updateForm('model', event.currentTarget.value)} variant={errors.model === undefined ? 'default' : 'error'} aria-invalid={errors.model === undefined ? undefined : true} aria-describedby={errors.model === undefined ? undefined : 'model-error'} placeholder="provider/model" autoComplete="off" spellCheck={false} disabled={isSaving} />
          {errors.model === undefined ? null : <p id="model-error" role="alert">{errors.model}</p>}
          <ConnectionTestStatus value={connection} />
          <div className="form-actions"><Tooltip content="Checks the URL, authentication, model availability, and a minimal provider request." render={<Button type="button" variant="secondary" disabled={isTesting || isSaving || isRequiredApiKeyMissing || form.apiKey === REDACTED_SECRET} onClick={() => void testConnection()} />}>Test connection</Tooltip><Button className="primary-action" type="submit" variant="primary" disabled={!hasPassedCurrentTest || isTesting || isSaving} loading={isSaving}>{submitLabel}</Button></div>
          <p className="form-footnote"><InfoIcon aria-hidden="true" /> Catbots has no in-app YAML editor. This form is the only way to save local configuration.</p>
        </form>
        <Dialog.Root><Dialog.Trigger render={(props) => <Button {...props} className="privacy-dialog-trigger" variant="ghost" size="sm">How is my key handled?</Button>} /><Dialog><Dialog.Title>Local-only credentials</Dialog.Title><Dialog.Description>Your key is held only by this password field until a successful local save. The stored value is never rendered again.</Dialog.Description><Dialog.Close render={(props) => <Button {...props} variant="secondary">Close</Button>} /></Dialog></Dialog.Root>
      </section>
    </Root>
  );
}
