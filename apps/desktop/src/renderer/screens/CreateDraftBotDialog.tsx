import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Banner, Button, Dialog, Input } from '@cloudflare/kumo';
import type { BotSummary, CatbotsDesktopApi } from '@catbots/contracts';

type CreateDraftBotDialogProps = {
  api: CatbotsDesktopApi['bots'];
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreated(bot: BotSummary): void;
};

type DraftForm = { name: string; market: string };
type DraftErrors = Partial<Record<keyof DraftForm, string>>;

function validate(form: DraftForm): DraftErrors {
  const errors: DraftErrors = {};
  if (form.name.trim().length === 0) errors.name = 'Enter a bot name.';
  else if (form.name.trim().length > 80) errors.name = 'Use 80 characters or fewer.';
  if (form.market.trim().length === 0) errors.market = 'Enter an initial market.';
  else if (form.market.trim().length > 40) errors.market = 'Use 40 characters or fewer.';
  return errors;
}

export function CreateDraftBotDialog({ api, open, onOpenChange, onCreated }: CreateDraftBotDialogProps) {
  const [form, setForm] = useState<DraftForm>({ name: '', market: '' });
  const [errors, setErrors] = useState<DraftErrors>({});
  const [error, setError] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const mountedRef = useRef(true);
  const creatingRef = useRef(false);
  const requestTokenRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const updateForm = (key: keyof DraftForm, value: string) => {
    if (creatingRef.current) return;
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
    setError(false);
  };

  const close = () => {
    if (creatingRef.current) return;
    setError(false);
    onOpenChange(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creatingRef.current) return;
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const requestToken = requestTokenRef.current + 1;
    requestTokenRef.current = requestToken;
    const input = { name: form.name.trim(), market: form.market.trim() };
    creatingRef.current = true;
    setIsCreating(true);
    setError(false);
    try {
      const created = await api.createDraft(input);
      if (!mountedRef.current || requestToken !== requestTokenRef.current) return;
      onCreated(created);
      setForm({ name: '', market: '' });
      onOpenChange(false);
    } catch {
      if (mountedRef.current && requestToken === requestTokenRef.current) setError(true);
    } finally {
      if (requestToken === requestTokenRef.current) creatingRef.current = false;
      if (mountedRef.current && requestToken === requestTokenRef.current) setIsCreating(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (nextOpen) onOpenChange(true); else close(); }}>
      <Dialog className="create-draft-dialog p-8" size="base">
        <Dialog.Title>Create a local draft</Dialog.Title>
        <Dialog.Description>Start with a name and market. Strategy, Backtest, and trading controls arrive in later milestones.</Dialog.Description>
        <form className="draft-form" onSubmit={submit}>
          <Input
            id="bot-name"
            label="Bot name"
            value={form.name}
            onChange={(event) => updateForm('name', event.currentTarget.value)}
            variant={errors.name === undefined ? 'default' : 'error'}
            aria-invalid={errors.name === undefined ? undefined : true}
            aria-describedby={errors.name === undefined ? undefined : 'bot-name-error'}
            disabled={isCreating}
            autoFocus
          />
          {errors.name === undefined ? null : <p id="bot-name-error" role="alert">{errors.name}</p>}
          <Input
            id="bot-market"
            label="Market"
            value={form.market}
            onChange={(event) => updateForm('market', event.currentTarget.value)}
            variant={errors.market === undefined ? 'default' : 'error'}
            aria-invalid={errors.market === undefined ? undefined : true}
            aria-describedby={errors.market === undefined ? undefined : 'bot-market-error'}
            disabled={isCreating}
          />
          {errors.market === undefined ? null : <p id="bot-market-error" role="alert">{errors.market}</p>}
          {error ? <Banner variant="error" role="alert" title="Draft not created" description="We could not create this draft. Review the local values and try again." /> : null}
          <div className="draft-form-actions">
            <Button type="button" variant="secondary" onClick={close} disabled={isCreating}>Cancel</Button>
            <Button type="submit" variant="primary" loading={isCreating} disabled={isCreating}>Create draft</Button>
          </div>
        </form>
      </Dialog>
    </Dialog.Root>
  );
}
