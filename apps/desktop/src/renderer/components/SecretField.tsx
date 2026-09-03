import { Input } from '@cloudflare/kumo';

type SecretFieldProps = {
  value: string;
  onValueChange(value: string): void;
  error?: string;
  storedMask?: string;
  disabled?: boolean;
};

/** Keeps a credential exclusively in the caller's component-local password state. */
export function SecretField({ value, onValueChange, error, storedMask, disabled }: SecretFieldProps) {
  return (
    <div className="secret-field">
      <Input
        id="api-key"
        label="API key"
        type="password"
        autoComplete="new-password"
        spellCheck={false}
        value={value}
        onChange={(event) => onValueChange(event.currentTarget.value)}
        variant={error === undefined ? 'default' : 'error'}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : 'api-key-error'}
        disabled={disabled}
        description={storedMask === undefined
          ? 'Plaintext stays only in this form’s memory. After save, it is stored locally and never displayed again.'
          : 'Leave blank to use the stored key. A replacement stays only in this form’s memory until save.'}
      />
      {error === undefined ? null : <p id="api-key-error" role="alert">{error}</p>}
      {storedMask !== undefined ? <p className="stored-secret">Stored key: {storedMask}</p> : null}
    </div>
  );
}
